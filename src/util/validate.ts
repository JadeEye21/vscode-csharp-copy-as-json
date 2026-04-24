/**
 * Decide whether the raw `result` from a DAP `evaluate` response can be
 * safely delivered to the clipboard as JSON. The check sequence is:
 *
 *   1. typeof check + non-empty;
 *   2. `looksLikeError` fast-path (skip the unescape/parse cost on obvious
 *      debugger error sentinels);
 *   3. unescape the C# string literal;
 *   4. `JSON.parse` it.
 *
 * `JSON.parse` is the validator (not regex) because the unescaped value is
 * exactly meant to be JSON; if it does not parse, it is wrong - typically
 * because the debug adapter truncated the response under a hover-context
 * size budget.
 *
 * Returns `{ ok: true, json }` when safe, otherwise `{ ok: false, reason }`
 * carrying a short, user-facing explanation that the caller can surface in
 * the error toast and trace channel.
 */
export type ValidateResult =
  | { ok: true; json: string }
  | { ok: false; reason: string };

export function validateEvaluateResult(
  raw: unknown,
  unescape: (s: string) => string,
  contextLabel: string,
): ValidateResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: `${contextLabel} returned an empty result` };
  }

  if (looksLikeError(raw)) {
    return {
      ok: false,
      reason: `${contextLabel} returned a debugger error sentinel: ${truncate(raw)}`,
    };
  }

  const unescaped = unescape(raw);
  if (!isValidJson(unescaped)) {
    return {
      ok: false,
      reason: `${contextLabel} response was not valid JSON (likely truncated by the debug adapter)`,
    };
  }

  return { ok: true, json: unescaped };
}

/**
 * `true` if `text` parses as JSON. We accept any JSON-valued top level
 * (object, array, primitive) - the .NET serializer can return any of these
 * depending on the variable type.
 */
export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Heuristic to detect debugger error sentinels returned in `result` rather
 * than as a DAP-level error response. The .NET adapters typically prefix
 * such results with `error CSxxxx:` or `Cannot evaluate ...`.
 *
 * Critically, both checks anchor at the start of the string so that valid
 * JSON whose contents merely contain the substrings "error" or "exception"
 * (e.g. `{"name":"NullReferenceException"}`) is NOT flagged.
 */
export function looksLikeError(raw: string): boolean {
  if (raw.startsWith('error ')) {
    return true;
  }
  if (/^Cannot (evaluate|find)/i.test(raw)) {
    return true;
  }
  return false;
}

function truncate(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
