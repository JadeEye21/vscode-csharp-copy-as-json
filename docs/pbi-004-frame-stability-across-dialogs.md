# PBI-004: Re-validate stack frame after the side-effect warning

## Status

**Completed in v0.1.0.** Note: PBI-011 / C5 removed the post-side-effect-warning re-capture step (the modal warning is gone in v0.2.0); `checkFrameStability` from this PBI still runs per evaluate attempt and is unchanged.

| Phase | Items | Status |
|---|---|---|
| 1 (re-order + capture) | Move `maybeShowSideEffectWarning` before frame capture; new `captureFrame()` re-reads after the dialog | Done in this PR |
| 1 (per-attempt re-check) | `checkFrameStability` invoked before every evaluate dispatch in the fallback loop | Done in this PR |
| 1 (canonical message) | `SESSION_MOVED_MESSAGE` constant; replaces three ad-hoc strings in `extension.ts` | Done in this PR |
| 1 (unit coverage) | 11 tests over the full decision matrix (match, session terminated, session id changed, no frame, frame's session changed, frameId changed, threadId changed, both differ, resumed) | Done in this PR |
| 2 (best-effort `cancel`) | `customRequest('cancel', ...)` on stability-check failure | **Deferred.** See "Deviations" below. |

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
| Best-effort cancel, do not block on it | Not all adapters support `cancel`; we already swallow its errors elsewhere. *(See "Deviations" - the public `customRequest` API does not actually allow cancellation, so this rule is preserved as future intent.)* |
| Show side-effect warning *before* frame capture | The first-run warning is the only first-class await boundary that can fire between the user clicking and the evaluate dispatching; capturing the frame after the dialog dismisses means the captured `frameId` is provably valid for at least the moment we send `evaluate`. |
| Pre-warning vs post-warning frame check use *different* messages | Pre-warning "no frame" almost always means the user invoked from the command palette without pausing - the friendly "Pause the debugger and select a frame" message helps them. Post-warning "no frame" almost always means they resumed during the dialog - "session moved" is the right framing. The menu's `when` clause prevents the first case for menu invocations, so the differentiation lines up cleanly with intent. |
| `threadId` is checked alongside `frameId` | Some adapters (and async-step paths) recycle frame ids across thread switches. A frame with the same numeric id but a different thread is no longer the same frame for `evaluate` purposes. |
| Pure `frameStability` module + caller-built snapshot | Same pattern as PBI-003: the decision matrix lives in a `vscode`-free module so the unit suite can exhaustively cover it without an Electron host. The two-line wrapper that builds the snapshot from `vscode.debug` is trivial review-by-eye glue. |

## Deviations from original plan

- **Best-effort `customRequest('cancel', ...)` not implemented.** The public `vscode.DebugSession.customRequest` API does not expose a `requestId` for in-flight requests and accepts no `CancellationToken`. There is no supported way to actually cancel a running `evaluate` from the extension side. `withTimeout` already bounds how long we wait on each evaluate (clamped to `csharpDebugCopyAsJson.evaluateTimeoutMs`), and the `checkFrameStability` re-check stops *new* evaluates when the session has moved. The "stale request still running on the adapter side" window is bounded by the timeout, not by an active cancel. The PBI bullet is preserved in "Architectural decisions" as future intent in case VS Code ever surfaces a cancellable customRequest.
- **No automated test asserts the end-to-end "press Continue during the warning produces the session-moved toast" scenario.** Same root cause as PBI-003's deferred fake-DAP test: driving a real or fake debug session through `vscode.debug.startDebugging` requires either a Marketplace `debuggers` contribution we don't want in the published package, or a real-debugger e2e harness (tracked separately). The decision logic itself (`checkFrameStability` matrix + `SESSION_MOVED_MESSAGE` canonicalization) is exhaustively unit-tested; the wiring in `runCopyAsJsonInner` is review-by-eye. **Promotion path: when the real-debugger e2e PBI lands, this scenario is one of its target assertions.**

## Acceptance criteria

- ⚠️ Pressing **Continue** while the side-effect warning is showing produces the "session moved" toast, not an adapter error trace. *(Asserted at the `checkFrameStability` decision boundary: `activeFrame: undefined` produces `SESSION_MOVED_MESSAGE`. End-to-end behavior covered by manual UAT until the real-debugger e2e PBI lands.)*
- ⚠️ Pressing **Step Over** between the `clipboard` and `hover` attempts in a deliberately slow scenario produces the same toast. *(Asserted at the `checkFrameStability` decision boundary: `frameId` mismatch produces `SESSION_MOVED_MESSAGE`. Per-attempt re-check is wired in `runCopyAsJsonInner`'s evaluate loop. End-to-end manual UAT until the real-debugger e2e PBI lands.)*
- ✅ The existing concurrency-guard `inFlight` check in PBI-001 still works (unchanged code path).
- ✅ Trace channel records the captured `{sessionId, frameId, threadId}` on capture and on each re-validation. (Two `trace(...)` calls added: one after `captureFrame`, one inside the per-attempt loop.)

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | First-ever invocation; click Continue while the warning is up | "Session moved" toast; clipboard unchanged. |
| 2 | Slow `evaluate`; user steps once between attempts | Same toast; no clipboard write. |
| 3 | Switch active session to a second `coreclr` session before triggering | Same toast (covers PBI-001 UAT #7). |
| 4 | Normal happy path (no stepping) | Behaves exactly as PBI-001 #1. |

## Telemetry

None.
