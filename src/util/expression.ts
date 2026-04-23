import type { DebugProtocol } from '@vscode/debugprotocol';

/**
 * Shape of the argument that VS Code passes to a command contributed under
 * `debug/variables/context`. Mirrors the internal `IVariablesContext` from
 * `vscode/src/vs/workbench/contrib/debug/browser/variablesView.ts`.
 *
 * `shouldForwardArgs: false` is used by the menu contribution, so this
 * object is the *only* argument the command handler receives.
 */
export interface IVariablesContext {
  sessionId?: string;
  container: DebugProtocol.Variable | DebugProtocol.Scope | DebugProtocol.EvaluateArguments;
  variable: DebugProtocol.Variable;
}

export type EvaluatableTarget =
  | { ok: true; expression: string }
  | { ok: false; reason: string };

/**
 * Resolve the C# subexpression that identifies the right-clicked variable.
 *
 * The .NET debug adapter populates `evaluateName` for most "real" variables
 * but leaves it `undefined` for synthesized children (`[Raw View]`,
 * `Static members`, certain auto-properties on collections). For container
 * cases where the parent is a watch expression, we can synthesize
 * `<parentExpression>.<name>`. Synthesized labels surfaced by the adapter
 * itself are rejected up front because they are not valid C# expressions.
 */
export function resolveEvaluatableTarget(arg: IVariablesContext): EvaluatableTarget {
  if (!arg || !arg.variable) {
    return { ok: false, reason: 'No variable context was provided.' };
  }

  const { variable, container } = arg;
  const name = variable.name;

  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'Variable has no usable name.' };
  }

  if (isSyntheticLabel(name)) {
    return {
      ok: false,
      reason: `"${name}" is a synthesized debugger node, not a real C# expression.`,
    };
  }

  if (typeof variable.evaluateName === 'string' && variable.evaluateName.length > 0) {
    return { ok: true, expression: variable.evaluateName };
  }

  if (container && typeof (container as DebugProtocol.EvaluateArguments).expression === 'string') {
    const parentExpr = (container as DebugProtocol.EvaluateArguments).expression;
    if (parentExpr.length > 0) {
      return { ok: true, expression: `${parentExpr}.${name}` };
    }
  }

  // Last-ditch: name on its own. This works for top-level locals.
  return { ok: true, expression: name };
}

/**
 * Synthesized labels emitted by the .NET adapter that are not valid C#
 * expressions. Right-clicking these and choosing Copy as JSON cannot work,
 * so we bail out with a clear message before sending an evaluate request
 * that will only fail in a less helpful way.
 */
function isSyntheticLabel(name: string): boolean {
  if (name === 'Static members' || name === 'Non-Public members') {
    return true;
  }
  if (name.startsWith('[') && name.endsWith(']')) {
    // `[Raw View]`, `[i]` for non-integer index, etc. We let real integer
    // indexers through since they ARE valid (`a[0]`), but the adapter
    // typically populates `evaluateName` for those, so they would have
    // returned above.
    const inner = name.slice(1, -1);
    if (!/^-?\d+$/.test(inner)) {
      return true;
    }
  }
  return false;
}

/**
 * Build the `System.Text.Json` serialization expression. Fully qualified to
 * avoid requiring `using` directives in the debuggee scope. The `(object)`
 * cast dodges an STJ source-generated overload trap on value types in some
 * `coreclr` versions.
 */
export function buildSystemTextJsonExpression(target: string): string {
  return `System.Text.Json.JsonSerializer.Serialize((object)(${target}), new System.Text.Json.JsonSerializerOptions { WriteIndented = true })`;
}

/**
 * Build the Newtonsoft.Json fallback expression. Requires the debuggee to
 * reference Newtonsoft.Json at runtime; if it does not, the evaluate call
 * will fail with a `CS0103` style error which we surface to the user.
 */
export function buildNewtonsoftExpression(target: string): string {
  return `Newtonsoft.Json.JsonConvert.SerializeObject((object)(${target}), Newtonsoft.Json.Formatting.Indented)`;
}
