# PBI-004: Re-validate stack frame after the side-effect warning

## Status

Proposed. Derived from code review of `v0.0.1` (critical C2).

## Goal

Today the side-effect warning is shown synchronously before the `evaluate` is dispatched, but the `frameId` is captured *before* the warning. If the user clicks Continue (or Step) during the dialog, by the time we evaluate, the frame is stale and the adapter returns an opaque error. We want the user to see a clean "session moved" message and not a confusing adapter dump.

## Scope

In:

- Show the side-effect warning *before* resolving the active stack frame on first run.
- After the user dismisses the warning, re-read `vscode.debug.activeStackItem` and `vscode.debug.activeDebugSession`. If either has changed (or is undefined), abort with a single-line toast: `Active debug session changed; please re-trigger Copy as JSON.`
- On every subsequent invocation, capture `{sessionId, frameId, threadId}` immediately before each evaluate and re-check after each `await` boundary in the fallback chain. If the trio changes mid-flight, abort with the same message.
- Cancel any in-flight evaluate via `customRequest('cancel', ...)` when the session changes (best effort; tolerate `Cancellation not supported`).

Out:

- Re-running the operation automatically on the new frame (would require the user's intent to change; not in scope).
- Suppressing the warning entirely (already handled by the "Don't show again" path).

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Re-validate after every `await` | The user can step at any point. Validating only at the start would still race. |
| Single error string for all "session moved" cases | Easier to test and to match in the existing concurrency-guard test. |
| Best-effort cancel, do not block on it | Not all adapters support `cancel`; we already swallow its errors elsewhere. |

## Acceptance criteria

- Pressing **Continue** while the side-effect warning is showing produces the "session moved" toast, not an adapter error trace.
- Pressing **Step Over** between the `clipboard` and `hover` attempts in a deliberately slow scenario produces the same toast.
- The existing concurrency-guard test in PBI-001 still passes.
- Trace channel records the captured `{sessionId, frameId}` on capture and on each re-validation.

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | First-ever invocation; click Continue while the warning is up | "Session moved" toast; clipboard unchanged. |
| 2 | Slow `evaluate`; user steps once between attempts | Same toast; no clipboard write. |
| 3 | Switch active session to a second `coreclr` session before triggering | Same toast (covers PBI-001 UAT #7). |
| 4 | Normal happy path (no stepping) | Behaves exactly as PBI-001 #1. |

## Telemetry

None.
