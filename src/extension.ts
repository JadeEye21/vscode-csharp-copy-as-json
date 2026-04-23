import * as vscode from 'vscode';
import {
  buildNewtonsoftExpression,
  buildSystemTextJsonExpression,
  resolveEvaluatableTarget,
  type IVariablesContext,
} from './util/expression.js';
import { unescapeCsharpString } from './util/unescape.js';

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
      trace(
        traceEnabled,
        `evaluate (${attempt.label}, context=${evalContext}): ${attempt.expression}`,
      );
      try {
        const resp = await withTimeout(
          session.customRequest('evaluate', {
            expression: attempt.expression,
            frameId,
            context: evalContext,
          }) as Thenable<DapEvaluateResponse>,
          timeoutMs,
          `${attempt.label} evaluate (${evalContext})`,
        );
        const raw = resp?.result;
        if (typeof raw === 'string' && raw.length > 0 && !looksLikeError(raw)) {
          const value = unescapeCsharpString(raw);
          await vscode.env.clipboard.writeText(value);
          trace(traceEnabled, `success: copied ${value.length} chars to clipboard`);
          void vscode.window.setStatusBarMessage(
            `$(clippy) Copied ${value.length} chars as JSON via ${attempt.label}`,
            4000,
          );
          return;
        }
        lastError = `${attempt.label} (${evalContext}) returned no usable result`;
        trace(traceEnabled, `empty/invalid result: ${JSON.stringify(resp)}`);
      } catch (err) {
        lastError = errorMessage(err);
        trace(traceEnabled, `error: ${lastError}`);
      }
    }
  }

  showError(`Could not serialize: ${lastError ?? 'unknown error'}`);
}

function pickEvaluateContexts(session: vscode.DebugSession): EvaluateContext[] {
  const supports = (
    session as unknown as { capabilities?: { supportsClipboardContext?: boolean } }
  ).capabilities?.supportsClipboardContext === true;
  return supports ? ['clipboard', 'hover', 'repl'] : ['hover', 'repl'];
}

function withTimeout<T>(p: Thenable<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(errorMessage(e)));
      },
    );
  });
}

function clampTimeout(value: number | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 8000;
  return Math.min(120_000, Math.max(500, n));
}

/**
 * Heuristic to detect debugger error sentinels returned in `result` rather
 * than as a DAP-level error response. The .NET adapter typically prefixes
 * such results with `error CSxxxx:` or `Cannot evaluate ...`.
 */
function looksLikeError(raw: string): boolean {
  if (raw.startsWith('error ')) {
    return true;
  }
  if (/^Cannot (evaluate|find)/i.test(raw)) {
    return true;
  }
  return false;
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
