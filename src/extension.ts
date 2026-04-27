import * as fs from 'node:fs';
import * as path from 'node:path';
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
  clearSession as clearCapabilitySession,
  createCapabilityTracker,
  getSupportsClipboardContext,
} from './util/clipboardCapability.js';
import {
  checkFrameStability,
  SESSION_MOVED_MESSAGE,
  type CapturedFrame,
  type CurrentSnapshot,
} from './util/frameStability.js';
import { ResultCache } from './util/resultCache.js';

const COMMAND_ID = 'csharpDebugCopyAsJson.copyAsJson';
const CONFIG_SECTION = 'csharpDebugCopyAsJson';
const SIDE_EFFECT_WARNING_KEY = 'csharpDebugCopyAsJson.sideEffectWarningShown';

type EvaluateContext = 'clipboard' | 'hover' | 'repl';

interface DapEvaluateResponse {
  result?: string;
  type?: string;
  variablesReference?: number;
}

let output: vscode.OutputChannel | undefined;
// Test-only file sink. See PBI-005 / PBI-010 for why this exists.
let e2eLogFile: string | undefined;

// PBI-011 module-level state ------------------------------------------------
//
// `currentCts` is the cancellation source for the in-flight `runCopyAsJson`
// invocation. A second click cancels and disposes the previous source before
// installing a new one. `Promise.race`-style cancellation on the awaits
// alone is not enough; every await checks `token.isCancellationRequested`
// before performing side effects (clipboard write, cache put), because the
// underlying DAP `customRequest` cannot itself be aborted.
let currentCts: vscode.CancellationTokenSource | undefined;

// `lastActiveStackItem` tracks the previously-focused frame so that
// `onDidChangeActiveStackItem` can invalidate that thread's cache entries.
// We invalidate both the previous thread AND the new thread on every
// change; this is intentionally over-eager (per the PBI-011 "stricter"
// invalidation rule confirmed by the user), and never serves stale data.
let lastActiveStackItem: { sessionId: string; threadId: number } | undefined;

const resultCache = new ResultCache();

// Memo of the first DAP `evaluate` context that returned a parseable result
// for a session. On subsequent invocations in the same session we try this
// context first before falling through the rest of the chain. Cleared on
// session terminate.
const winningContext = new Map<string, EvaluateContext>();
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Copy as JSON');
  context.subscriptions.push(output);

  // Test-only seam: when our e2e harness sets CSHARP_COPY_AS_JSON_E2E=1 in
  // extensionTestsEnv, pre-seed the disclosure-shown flag so the one-time
  // output-channel notice does not pollute the test log, and open a
  // file-backed sink in the workspace root.
  if (process.env.CSHARP_COPY_AS_JSON_E2E === '1') {
    void context.globalState.update(SIDE_EFFECT_WARNING_KEY, true);
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (wsFolder) {
      e2eLogFile = path.join(wsFolder.uri.fsPath, 'test.trace.log');
      try {
        fs.writeFileSync(e2eLogFile, '');
      } catch {
        e2eLogFile = undefined;
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, (arg: IVariablesContext) =>
      runCopyAsJson(arg, context),
    ),
  );

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(session) {
        return createCapabilityTracker(session.id);
      },
    }),
  );

  // PBI-011 / C2: result-cache invalidation. `onDidChangeActiveStackItem`
  // fires for stepping, continuing, and Call-Stack-view frame switching;
  // all three cases need the cache eviction (per AC #4).
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveStackItem(() => {
      const previous = lastActiveStackItem;
      if (previous) {
        resultCache.clearThread(previous.sessionId, previous.threadId);
      }
      const stackItem = vscode.debug.activeStackItem;
      if (stackItem instanceof vscode.DebugStackFrame) {
        resultCache.clearThread(stackItem.session.id, stackItem.threadId);
        lastActiveStackItem = {
          sessionId: stackItem.session.id,
          threadId: stackItem.threadId,
        };
      } else {
        lastActiveStackItem = undefined;
      }
    }),
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      clearCapabilitySession(session.id);
      resultCache.clearSession(session.id);
      winningContext.delete(session.id);
    }),
  );
}

export function deactivate(): void {
  output = undefined;
  e2eLogFile = undefined;
  if (currentCts) {
    currentCts.cancel();
    currentCts.dispose();
    currentCts = undefined;
  }
  resultCache.clearAll();
  winningContext.clear();
  lastActiveStackItem = undefined;
}

async function runCopyAsJson(
  arg: IVariablesContext,
  context: vscode.ExtensionContext,
): Promise<void> {
  // PBI-011 / C3: cancel-and-replace dispatch. The previous in-flight
  // invocation is cancelled and disposed; its DAP `evaluate` call may still
  // execute in the debuggee (we cannot abort that), but the extension will
  // ignore its response.
  if (currentCts) {
    currentCts.cancel();
    currentCts.dispose();
  }
  const cts = new vscode.CancellationTokenSource();
  currentCts = cts;
  try {
    await runCopyAsJsonInner(arg, context, cts.token);
  } finally {
    if (currentCts === cts) {
      currentCts = undefined;
    }
    cts.dispose();
  }
}

async function runCopyAsJsonInner(
  arg: IVariablesContext,
  context: vscode.ExtensionContext,
  token: vscode.CancellationToken,
): Promise<void> {
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
    showError(SESSION_MOVED_MESSAGE);
    return;
  }

  const stackItem = vscode.debug.activeStackItem;
  if (!stackItem || !(stackItem instanceof vscode.DebugStackFrame)) {
    showError(
      'No focused stack frame. Pause the debugger and select a frame in the Call Stack view, then try again.',
    );
    return;
  }
  if (stackItem.session.id !== initialSession.id) {
    showError(SESSION_MOVED_MESSAGE);
    return;
  }

  const target = resolveEvaluatableTarget(arg);
  if (!target.ok) {
    showError(target.reason);
    return;
  }

  const captured: CapturedFrame = {
    sessionId: initialSession.id,
    frameId: stackItem.frameId,
    threadId: stackItem.threadId,
  };

  const traceEnabled = cfg.get<boolean>('trace', false);

  // PBI-011 / C1: cache lookup. A hit short-circuits the entire DAP path.
  const cached = resultCache.get(
    captured.sessionId,
    captured.threadId,
    captured.frameId,
    target.expression,
  );
  if (cached !== undefined) {
    if (token.isCancellationRequested) {
      return;
    }
    await vscode.env.clipboard.writeText(cached);
    if (token.isCancellationRequested) {
      return;
    }
    trace(
      traceEnabled,
      `cache hit: ${target.expression} (${cached.length} chars)`,
    );
    void vscode.window.setStatusBarMessage(
      `$(check) Copied ${cached.length} chars as JSON (cached)`,
      4000,
    );
    return;
  }

  // ----- Cache miss: evaluate path -----

  // PBI-011 / C5a: one-time output-channel disclosure on first invocation
  // per install. Replaces the previous modal-ish info-message dialog. The
  // existing `SIDE_EFFECT_WARNING_KEY` is reused so users who already
  // dismissed the old dialog do not see the disclosure again.
  maybeShowOneTimeDisclosure(context);

  // PBI-011 / C5b: per-invocation transient reminder. Suppressed when the
  // user has set `showSideEffectReminder: false`.
  const showReminder = cfg.get<boolean>('showSideEffectReminder', true);
  if (showReminder) {
    void vscode.window.setStatusBarMessage(
      '$(info) Copy as JSON: evaluating in debuggee process',
      3000,
    );
  }

  // PBI-011 / C6: dispatch spinner. Disposed in the `finally` so cancel,
  // failure, and success all clear the spin promptly.
  const spinDisposable = vscode.window.setStatusBarMessage(
    '$(sync~spin) Copy as JSON\u2026',
  );

  try {
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

    // PBI-011 / C4: try the per-session winning context first.
    const baseContexts = pickEvaluateContexts(initialSession);
    const memo = winningContext.get(initialSession.id);
    const contexts: EvaluateContext[] =
      memo && baseContexts.includes(memo)
        ? [memo, ...baseContexts.filter((c) => c !== memo)]
        : baseContexts;

    trace(traceEnabled, `target = ${target.expression}`);
    trace(traceEnabled, `evaluate contexts = ${contexts.join(', ')}`);

    let lastError: string | undefined;
    for (const attempt of ordered) {
      for (const evalContext of contexts) {
        if (token.isCancellationRequested) {
          trace(traceEnabled, 'cancelled');
          return;
        }
        const stability = checkFrameStability(captured, snapshotCurrent());
        if (!stability.ok) {
          trace(
            traceEnabled,
            `frame stability check failed: ${stability.reason}`,
          );
          showError(stability.reason);
          return;
        }
        const contextLabel = `${attempt.label} (${evalContext})`;
        trace(
          traceEnabled,
          `evaluate (${contextLabel}): ${attempt.expression}`,
        );
        try {
          const resp = await withTimeout(
            initialSession.customRequest('evaluate', {
              expression: attempt.expression,
              frameId: captured.frameId,
              context: evalContext,
            }) as Thenable<DapEvaluateResponse>,
            timeoutMs,
            `${contextLabel} evaluate`,
          );
          if (token.isCancellationRequested) {
            trace(traceEnabled, 'cancelled after evaluate');
            return;
          }
          const validation = validateEvaluateResult(
            resp?.result,
            unescapeCsharpString,
            contextLabel,
          );
          if (validation.ok) {
            if (token.isCancellationRequested) {
              trace(traceEnabled, 'cancelled before clipboard write');
              return;
            }
            await vscode.env.clipboard.writeText(validation.json);
            // Re-check after the clipboard write: a later click may have
            // already overwritten our value, in which case we must NOT
            // poison the cache with the stale entry. We still leave the
            // clipboard alone -- the later click wrote intentionally.
            if (token.isCancellationRequested) {
              trace(
                traceEnabled,
                'cancelled after clipboard write; not caching',
              );
              return;
            }
            resultCache.put(
              captured.sessionId,
              captured.threadId,
              captured.frameId,
              target.expression,
              validation.json,
            );
            winningContext.set(initialSession.id, evalContext);
            trace(
              traceEnabled,
              `success: copied ${validation.json.length} chars to clipboard via ${contextLabel}`,
            );
            void vscode.window.setStatusBarMessage(
              `$(check) Copied ${validation.json.length} chars as JSON via ${attempt.label}`,
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

    if (token.isCancellationRequested) {
      return;
    }
    showError(`Could not serialize: ${lastError ?? 'unknown error'}`);
  } finally {
    spinDisposable.dispose();
  }
}

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
  // `activate`. A cache miss means we never observed an InitializeResponse.
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
  const ts = new Date().toISOString();
  writeE2eLog(`[${ts}] ${message}`);
  if (!enabled || !output) {
    return;
  }
  output.appendLine(`[${ts}] ${message}`);
}

function showError(message: string): void {
  writeE2eLog(`[ERROR] ${message}`);
  void vscode.window
    .showErrorMessage(`Copy as JSON: ${message}`, 'View Logs')
    .then((choice) => {
      if (choice === 'View Logs' && output) {
        output.show(true);
      }
    });
}

function writeE2eLog(line: string): void {
  if (!e2eLogFile) {
    return;
  }
  try {
    fs.appendFileSync(e2eLogFile, line + '\n');
  } catch {
    // Sink failures must never fail the user's command.
  }
}

function maybeShowOneTimeDisclosure(context: vscode.ExtensionContext): void {
  const shown = context.globalState.get<boolean>(
    SIDE_EFFECT_WARNING_KEY,
    false,
  );
  if (shown) {
    return;
  }
  if (output) {
    output.appendLine(
      '[disclosure] Copy as JSON evaluates JsonSerializer.Serialize inside ' +
        'your debugged process. This invokes property getters and ' +
        'constructors, which may have side effects, allocate memory, or ' +
        'throw. See README for details. (Shown once per install.)',
    );
  }
  void context.globalState.update(SIDE_EFFECT_WARNING_KEY, true);
}
