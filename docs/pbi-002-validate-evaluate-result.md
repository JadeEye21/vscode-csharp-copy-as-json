# PBI-002: Validate evaluate result before clipboard write

## Status

**In progress.** Branch `feature/pbi-002-validate-evaluate-result` extracts validation into pure modules, wires them into `extension.ts`, and adds unit tests covering C1 (truncation rejection) and R5 (looksLikeError regressions). R1 (repl-context echo stripping) is **explicitly deferred** - see "Deviations from plan" below.

## Goal

Ensure that what we put on the clipboard is actually a serialized JSON document, not a truncated debug-adapter `toString`, an error message phrased like a value, or a `repl` decoration. Today the extension trusts the first non-empty `evaluate.result` per context and then runs it through a C# unescaper. If a hover-context evaluate returns the truncated form `"{ Name = ..."`, we cheerfully unescape and copy garbage.

## Scope

In:

- After every `evaluate` attempt, run the unescaped string through `JSON.parse` and reject the result if it does not parse.
- On `repl` context responses, strip the leading echo decoration produced by some adapters before validating.
- Tighten `looksLikeError` so it does not false-positive on serialized strings that happen to contain the word "exception" (e.g. `{"Name":"NullReferenceException sample"}`).
- When all contexts return parse-failures, surface the original `result` (truncated to N chars) in the error toast and full payload to the trace channel.

Out:

- Adapter-side fixes for truncation. We do client-side validation only.
- Falling back to `variablesReference` traversal for over-budget objects (tracked in PBI-001 follow-ups).

## Architectural decisions

| Decision | Reasoning |
|---|---|
| `JSON.parse` is the validator (not regex) | The unescaped output is exactly meant to be JSON; if it does not parse, it is wrong. |
| Validate after unescape, not before | C# string literal escapes are not legal JSON; we must unescape first. |
| Treat parse failure as a context failure, not a hard error | We still want to fall through `clipboard -> hover -> repl` and try Newtonsoft. |

## Acceptance criteria

- A truncated hover-context response no longer reaches the clipboard. Either the next context succeeds or the user sees a `Could not serialize: response was truncated by the debug adapter` toast.
- `looksLikeError` returns `false` for valid JSON whose contents happen to contain the substrings `error` / `exception`.
- Unit tests cover: `JSON.parse` happy path, parse-failure rejection, `repl` echo stripping, false-positive `looksLikeError` regression.
- Manual UAT: scenario 1 from PBI-001 still passes; a deliberately truncated value (e.g. `trap.Slow` mid-evaluation) shows the truncation toast.

## UAT checklist

| # | Variable / scenario | Expected result |
|---|---|---|
| 1 | `person` | Indented JSON, identical to PBI-001 #1. |
| 2 | A large object whose serialized form exceeds the hover-context budget | Either Newtonsoft path succeeds or truncation toast appears; clipboard is never set to the truncated string. |
| 3 | `{"Name":"NullReferenceException sample"}` synthesized via the immediate window | JSON written to clipboard; not flagged as an error. |
| 4 | Forced `JSON.parse` failure (mock) | Trace channel logs full payload; user-facing toast is one line. |

## Deviations from plan

- **Repl-echo stripping (R1) is deferred.** The original PBI claimed "some adapters" prefix `repl`-context responses with the expression itself. We have not confirmed this against any specific .NET adapter (`netcoredbg`, `vsdbg`, `coreclr`, `clr`). Implementing speculative stripping now would risk corrupting valid responses. Instead, the validator currently treats any non-JSON response as a context failure, so an echoed response - if one ever appears - falls through to the next attempt cleanly. A regression test (`'rejects what looks like a repl-context echo'`) locks this in. If we observe an echo in the wild, follow-up work will add a targeted strip step.
- **Phase-2 utility coverage from PBI-005 is closed by this PR.** `withTimeout` and `looksLikeError` now have unit tests. The PBI-005 status table will be updated accordingly.

## Telemetry

None.
