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
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    showError('No active debug session.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const allowedTypes = cfg.get<string[]>('allowedDebugTypes', ['coreclr', 'clr']);
  if (!allowedTypes.includes(session.type)) {
    showError(
      `Active debug session type '${session.type}' is not in csharpDebugCopyAsJson.allowedDebugTypes.`,
    );
    return;
  }

  if (arg && arg.sessionId && session.id !== arg.sessionId) {
    showError('Active debug session changed; please re-trigger Copy as JSON.');
    return;
  }

  const stackItem = vscode.debug.activeStackItem;
  if (!stackItem || !(stackItem instanceof vscode.DebugStackFrame)) {
    showError(
      'No focused stack frame. Pause the debugger and select a frame in the Call Stack view, then try again.',
    );
    return;
  }
  if (stackItem.session.id !== session.id) {
    showError('Focused stack frame belongs to a different debug session.');
    return;
  }
  const frameId = stackItem.frameId;

  const target = resolveEvaluatableTarget(arg);
  if (!target.ok) {
    showError(target.reason);
    return;
  }

  await maybeShowSideEffectWarning(context);

  const timeoutMs = clampTimeout(cfg.get<number>('evaluateTimeoutMs', 8000));
  const preferNewtonsoft = cfg.get<boolean>('preferNewtonsoft', false);
  const traceEnabled = cfg.get<boolean>('trace', false);

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

  const contexts = pickEvaluateContexts(session);
  trace(traceEnabled, `target = ${target.expression}`);
  trace(traceEnabled, `frameId = ${frameId}, evaluate contexts = ${contexts.join(', ')}`);

  let lastError: string | undefined;
  for (const attempt of ordered) {
    for (const evalContext of contexts) {
      const contextLabel = `${attempt.label} (${evalContext})`;
      trace(
        traceEnabled,
        `evaluate (${contextLabel}): ${attempt.expression}`,
      );
      try {
        const resp = await withTimeout(
          session.customRequest('evaluate', {
            expression: attempt.expression,
            frameId,
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
