import * as vscode from 'vscode';
import {
  buildNewtonsoftExpression,
  buildSystemTextJsonExpression,
  resolveEvaluatableTarget,
  type IVariablesContext,
} from './util/expression.js';
import { unescapeCsharpString } from './util/unescape.js';
import { validateEvaluateResult } from './util/validate.js';
import { withTimeout } from './util/withTimeout.js';
import {
  clearSession,
  createCapabilityTracker,
  getSupportsClipboardContext,
} from './util/clipboardCapability.js';
import {
  checkFrameStability,
  SESSION_MOVED_MESSAGE,
  type CapturedFrame,
  type CurrentSnapshot,
} from './util/frameStability.js';

const COMMAND_ID = 'csharpDebugCopyAsJson.copyAsJson';
const CONFIG_SECTION = 'csharpDebugCopyAsJson';
const SIDE_EFFECT_WARNING_KEY = 'csharpDebugCopyAsJson.sideEffectWarningShown';

type EvaluateContext = 'clipboard' | 'hover' | 'repl';

interface DapEvaluateResponse {
  result?: string;
  type?: string;
  variablesReference?: number;
}

let inFlight = false;
let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Copy as JSON');
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, (arg: IVariablesContext) =>
      runCopyAsJson(arg, context),
    ),
  );
  // Watch every debug session's InitializeResponse so we know, authoritatively,
  // whether the adapter supports DAP `evaluate` with `context: 'clipboard'`.
  // Registered for `'*'` rather than `coreclr`/`clr` because the user can
  // override `csharpDebugCopyAsJson.allowedDebugTypes`; the cost of a no-op
  // tracker on unrelated sessions (one closure, one event subscription) is
  // negligible compared to silently demoting the user to `hover`.
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(session) {
        return createCapabilityTracker(session.id);
      },
    }),
  );
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      clearSession(session.id);
    }),
  );
}

export function deactivate(): void {
  output = undefined;
  inFlight = false;
}

async function runCopyAsJson(arg: IVariablesContext, context: vscode.ExtensionContext): Promise<void> {
  if (inFlight) {
    void vscode.window.showInformationMessage(
      'Copy as JSON is already running for the previous variable. Wait for it to finish.',
    );
    return;
  }
  inFlight = true;
  try {
    await runCopyAsJsonInner(arg, context);
  } finally {
    inFlight = false;
  }
}

async function runCopyAsJsonInner(
  arg: IVariablesContext,
  context: vscode.ExtensionContext,
): Promise<void> {
  // ------------------------------------------------------------------
  // Pre-warning gates: synchronous, no awaits, so the user cannot step
  // between these checks and the error toasts.
  // ------------------------------------------------------------------
  const initialSession = vscode.debug.activeDebugSession;
  if (!initialSession) {
    showError('No active debug session.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const allowedTypes = cfg.get<string[]>('allowedDebugTypes', ['coreclr', 'clr']);
  if (!allowedTypes.includes(initialSession.type)) {
    showError(
      `Active debug session type '${initialSession.type}' is not in csharpDebugCopyAsJson.allowedDebugTypes.`,
    );
    return;
  }

  if (arg && arg.sessionId && initialSession.id !== arg.sessionId) {
    // Menu invocation arg disagrees with the now-active session: focus moved
    // between the right-click and the command callback.
    showError(SESSION_MOVED_MESSAGE);
    return;
  }

  // Existence check (not capture). If the user invoked from the command
  // palette without pausing, surface the friendly "you forgot to pause"
  // message here, before the side-effect warning ever appears.
  const preCheckFrame = vscode.debug.activeStackItem;
  if (!preCheckFrame || !(preCheckFrame instanceof vscode.DebugStackFrame)) {
    showError(
      'No focused stack frame. Pause the debugger and select a frame in the Call Stack view, then try again.',
    );
    return;
  }
  if (preCheckFrame.session.id !== initialSession.id) {
    showError(SESSION_MOVED_MESSAGE);
    return;
  }

  const target = resolveEvaluatableTarget(arg);
  if (!target.ok) {
    showError(target.reason);
    return;
  }

  // ------------------------------------------------------------------
  // Side-effect warning (PBI-001) is shown here -- BEFORE we capture the
  // frame id. On the first-ever invocation this is an await boundary the
  // user can step over; capturing the frame after the dialog dismisses is
  // what closes review item C2 (PBI-004). On every subsequent invocation
  // the warning is a no-op (globalState says "shown"), so this re-ordering
  // does not affect the steady-state flow.
  // ------------------------------------------------------------------
  await maybeShowSideEffectWarning(context);

  const traceEnabled = cfg.get<boolean>('trace', false);

  // Re-capture after the warning. If the user clicked Continue or Step
  // during the dialog, the frame is now gone or different and we abort
  // with the canonical "session moved" message instead of letting an
  // adapter-level "stale frame" error reach the user.
  const captured = captureFrame(initialSession.id);
  if (!captured.ok) {
    trace(traceEnabled, `post-warning capture failed: ${captured.reason}`);
    showError(captured.reason);
    return;
  }
  trace(
    traceEnabled,
    `captured frame: sessionId=${captured.frame.sessionId}, frameId=${captured.frame.frameId}, threadId=${captured.frame.threadId}`,
  );

  const timeoutMs = clampTimeout(cfg.get<number>('evaluateTimeoutMs', 8000));
  const preferNewtonsoft = cfg.get<boolean>('preferNewtonsoft', false);

  const stjExpr = buildSystemTextJsonExpression(target.expression);
  const newtonExpr = buildNewtonsoftExpression(target.expression);
  const ordered = preferNewtonsoft
    ? [
        { label: 'Newtonsoft.Json', expression: newtonExpr },
        { label: 'System.Text.Json', expression: stjExpr },
      ]
    : [
        { label: 'System.Text.Json', expression: stjExpr },
        { label: 'Newtonsoft.Json', expression: newtonExpr },
      ];

  const contexts = pickEvaluateContexts(initialSession);
  trace(traceEnabled, `target = ${target.expression}`);
  trace(traceEnabled, `evaluate contexts = ${contexts.join(', ')}`);

  let lastError: string | undefined;
  for (const attempt of ordered) {
    for (const evalContext of contexts) {
      // Re-validate before EVERY evaluate: each prior await (the previous
      // attempt's customRequest, or the warning) is a step opportunity.
      const stability = checkFrameStability(captured.frame, snapshotCurrent());
      if (!stability.ok) {
        trace(traceEnabled, `frame stability check failed: ${stability.reason}`);
        showError(stability.reason);
        return;
      }
      trace(
        traceEnabled,
        `re-validated frame: sessionId=${captured.frame.sessionId}, frameId=${captured.frame.frameId}`,
      );

      const contextLabel = `${attempt.label} (${evalContext})`;
      trace(
        traceEnabled,
        `evaluate (${contextLabel}): ${attempt.expression}`,
      );
      try {
        const resp = await withTimeout(
          initialSession.customRequest('evaluate', {
            expression: attempt.expression,
            frameId: captured.frame.frameId,
            context: evalContext,
          }) as Thenable<DapEvaluateResponse>,
          timeoutMs,
          `${contextLabel} evaluate`,
        );
        const validation = validateEvaluateResult(
          resp?.result,
          unescapeCsharpString,
          contextLabel,
        );
        if (validation.ok) {
          await vscode.env.clipboard.writeText(validation.json);
          trace(
            traceEnabled,
            `success: copied ${validation.json.length} chars to clipboard via ${contextLabel}`,
          );
          void vscode.window.setStatusBarMessage(
            `$(clippy) Copied ${validation.json.length} chars as JSON via ${attempt.label}`,
            4000,
          );
          return;
        }
        lastError = validation.reason;
        trace(
          traceEnabled,
          `validation failed: ${validation.reason}; raw=${JSON.stringify(resp)}`,
        );
      } catch (err) {
        lastError = errorMessage(err);
        trace(traceEnabled, `error: ${lastError}`);
      }
    }
  }

  showError(`Could not serialize: ${lastError ?? 'unknown error'}`);
}

/**
 * Read the live `vscode.debug` state and return the focused frame iff it
 * still belongs to `expectedSessionId`. Used immediately after the
 * side-effect warning to detect a Continue/Step that fired while the dialog
 * was open (PBI-004 / review item C2).
 */
function captureFrame(
  expectedSessionId: string,
):
  | { ok: true; frame: CapturedFrame }
  | { ok: false; reason: string } {
  const session = vscode.debug.activeDebugSession;
  if (!session || session.id !== expectedSessionId) {
    return { ok: false, reason: SESSION_MOVED_MESSAGE };
  }
  const stackItem = vscode.debug.activeStackItem;
  if (
    !stackItem ||
    !(stackItem instanceof vscode.DebugStackFrame) ||
    stackItem.session.id !== expectedSessionId
  ) {
    return { ok: false, reason: SESSION_MOVED_MESSAGE };
  }
  return {
    ok: true,
    frame: {
      sessionId: expectedSessionId,
      frameId: stackItem.frameId,
      threadId: stackItem.threadId,
    },
  };
}

/**
 * Snapshot the live `vscode.debug` state into the shape `checkFrameStability`
 * expects. Kept tiny and side-effect-free so that the per-attempt re-check
 * loop adds negligible cost on the happy path.
 */
function snapshotCurrent(): CurrentSnapshot {
  const session = vscode.debug.activeDebugSession;
  const stackItem = vscode.debug.activeStackItem;
  const isFrame = stackItem instanceof vscode.DebugStackFrame;
  return {
    activeSessionId: session?.id,
    activeFrame: isFrame
      ? {
          sessionId: stackItem.session.id,
          frameId: stackItem.frameId,
          threadId: stackItem.threadId,
        }
      : undefined,
  };
}

function pickEvaluateContexts(session: vscode.DebugSession): EvaluateContext[] {
  // The cache is populated by the DebugAdapterTracker we register in
  // `activate`. A cache miss means we never observed an InitializeResponse for
  // this session - either the tracker was registered too late (impossible
  // given `onDebug` activation) or the adapter never sent capabilities. The
  // safe default is `false`: skip `clipboard` and use `hover -> repl`, which
  // is what every adapter is required to support.
  const supports = getSupportsClipboardContext(session.id) === true;
  return supports ? ['clipboard', 'hover', 'repl'] : ['hover', 'repl'];
}

function clampTimeout(value: number | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 8000;
  return Math.min(120_000, Math.max(500, n));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function trace(enabled: boolean, message: string): void {
  if (!enabled || !output) {
    return;
  }
  const ts = new Date().toISOString();
  output.appendLine(`[${ts}] ${message}`);
}

function showError(message: string): void {
  void vscode.window
    .showErrorMessage(`Copy as JSON: ${message}`, 'View Logs')
    .then((choice) => {
      if (choice === 'View Logs' && output) {
        output.show(true);
      }
    });
}

async function maybeShowSideEffectWarning(context: vscode.ExtensionContext): Promise<void> {
  const shown = context.globalState.get<boolean>(SIDE_EFFECT_WARNING_KEY, false);
  if (shown) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Copy as JSON evaluates 'JsonSerializer.Serialize' inside your debugged process. " +
      'This invokes property getters and constructors, which may have side effects, allocate memory, or throw.',
    'Got it',
    "Don't show again",
  );
  if (choice === "Don't show again" || choice === 'Got it') {
    await context.globalState.update(SIDE_EFFECT_WARNING_KEY, true);
  }
}
