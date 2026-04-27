# PBI-011: Real-time Copy as JSON — frame-scoped cache, cancelable dispatch, non-blocking side-effect notice

## Status

Proposed. Triggered by user-reported "already running" lock-up after a successful copy followed by an unrelated clipboard write, plus a request for instant-feel re-copy on the same paused frame. Inserts ahead of PBI-006 (which remains paused on `main`). Implementation of C2 forces a one-minor-version bump of the engine floor from `^1.89.0` to `^1.90.0`; see the corresponding decision row below.

## Goal

Make Copy as JSON behave like a clipboard operation, not a debug operation, on the warm path. Eliminate the "already running" failure mode entirely. Preserve correctness — never serve stale JSON across a step or session boundary.

## Scope

In:

- **C1 / Frame-scoped result cache.** Cache key `(sessionId, threadId, frameId, resolvedExpression)` → JSON string. Cache hit writes to clipboard with no DAP round-trip. In-memory, session-lifetime, no TTL, no size cap.
- **C2 / Cache invalidation.** Subscribe to `vscode.debug.onDidChangeActiveStackItem` and `vscode.debug.onDidTerminateDebugSession`. On stack-item change, clear entries for that `(sessionId, threadId)`. On session terminate, clear all entries for that `sessionId`. No invalidation on breakpoint mutation (we never read by breakpoint id).
- **C3 / Cancelable dispatch.** Replace the `inFlight` boolean with a per-extension `CancellationTokenSource`. A new invocation calls `.cancel()` on the previous and overwrites it. The in-flight `customRequest` is wrapped in `Promise.race` against the token; on cancel we abandon the response. Last click wins the clipboard. The DAP `evaluate` itself cannot be aborted — the debugger still runs the cancelled call to completion in the debuggee, but the extension ignores the result.
- **C4 / Winning-context memoization.** Per `sessionId`: remember the first context (`clipboard | hover | repl`) that returned a parseable result. Subsequent invocations in the same session try that context first; only on failure do they fall through the rest of the chain. Cleared on `onDidTerminateDebugSession`.
- **C5 / Non-blocking side-effect notice.**
  - **C5a.** One-time `OutputChannel.appendLine` disclosure on first invocation per install, gated by the existing `csharpDebugCopyAsJson.sideEffectWarningShown` `globalState` key. Replaces the modal-ish `showInformationMessage` dialog.
  - **C5b.** Per-invocation transient status-bar reminder `$(info) Copy as JSON: evaluating in debuggee process` for ~3 s. Suppressed when the new setting `csharpDebugCopyAsJson.showSideEffectReminder` is `false`. Default `true`.
- **C6 / Status-bar feedback on dispatch.** On every invocation, immediately show `$(sync~spin) Copy as JSON…` in the status bar. Cleared on success, cache hit, failure, or cancel.

Out:

- Pre-warm on variable hover / expand. Conflicts with the side-effect contract — would issue evaluates the user never asked for.
- Cross-session persistent cache. DAP `frameId` is session-scoped; nothing transferable.
- Cache invalidation on watch-expression evaluation. Best-effort within a paused frame, accepted by user.
- Real cancellation of the DAP `evaluate` request. VS Code does not propagate cancellation to debug adapters.
- Removing the side-effect notice entirely. The disclosure is preserved (output channel + status bar) — only the modality is removed.

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Cache key includes `threadId` | DAP `frameId` is unique only per thread per session. Multi-threaded debuggees would otherwise collide. |
| Invalidate on `onDidChangeActiveStackItem`, not on `continued`/`stopped` DAP events | Single source of truth. Stepping fires this event. Switching frames in the Call Stack view also fires it (correctly invalidates because the user is now looking at a different frame). User confirmed this stricter rule (Call Stack frame switch should invalidate). |
| Cancel-and-replace, not concurrent or queued | Two parallel evaluates would double the side effects in the debuggee, which is exactly what users were warned about. Cancel keeps a single live response in flight at the extension layer. |
| Winning-context memo per session, not global | `supportsClipboardContext` is per-session; preference can flip between a `coreclr` session and a hypothetical `mono` session. |
| In-memory cache, no eviction | A typical debug session pauses tens of times, not thousands. Each entry is one JSON string. Memory growth is bounded by user attention span. |
| Side-effect notice via output channel + status bar, not dialog | User explicitly requested non-blocking. Disclosure preserved; user agency over flow restored. |
| Drop `inFlight` boolean entirely | The cancellation-token model subsumes its job. Keeping both would be two locks racing each other. |
| `showSideEffectReminder` setting, default `true` | Power users who already understand the side-effect contract can mute the per-invocation reminder; default keeps disclosure visible. |
| Bump `engines.vscode` floor from `^1.89.0` to `^1.90.0` | `vscode.debug.onDidChangeActiveStackItem` (used by C2) and `vscode.debug.activeStackItem` (used by the pre-existing PBI-004 capture path) only graduated from the `debugFocus` proposal in VS Code 1.90.0 (microsoft/vscode#212190, May 2024). Subscribing at activation on 1.89.x throws and the extension fails to load — caught by the PBI-005 activation-smoke test on its first run against the floor. PBI-001 mistakenly advertised `^1.89.0` as the floor: the API was *proposed* in 1.89, not stable. PBI-011 is the first feature to surface the bug because C2 subscribes at activation time; PBI-004's lazy property reads would only have thrown at command-invocation time. This bump fixes today's regression and the latent 0.1.x risk in a single change; `VSCODE_TEST_VERSION` in `ci.yml`/`release.yml` and `DEFAULT_VSCODE_VERSION` in `runIntegration.ts` are bumped in lockstep so CI's smoke gate keeps proving the floor. |

## UX notes

- Status-bar messages, in order across an invocation:
  - Immediate: `$(sync~spin) Copy as JSON…`.
  - On cache hit: `$(check) Copied N chars as JSON (cached)` for 4 s.
  - On evaluate success: `$(check) Copied N chars as JSON via <serializer>` for 4 s.
  - On failure or cancel: spin cleared; error toast surfaces as today (cancel is silent — no toast).
- Cache hits issue zero debug-adapter requests. Verifiable via `csharpDebugCopyAsJson.trace: true` (logs `cache hit: <expression>` instead of `evaluate (...)`).
- The C5b reminder fires on every click while `showSideEffectReminder` is `true`. Cheap, non-blocking, keeps disclosure in front of the user. Mutable.
- C5a output-channel disclosure runs once per install (existing `globalState` key reused — upgrading users who already dismissed the dialog will not see the disclosure again).

## Acceptance criteria

1. Click Copy as JSON, do not paste, copy unrelated text, click Copy as JSON again on the same paused variable → clipboard now contains the JSON. No "already running" toast, ever, under any sequence of clicks.
2. With `trace: true`, the second click in (1) emits `cache hit:` and *no* `evaluate (...)` line.
3. Step over → click Copy as JSON on the same variable → emits `evaluate (...)`, not a cache hit. (Cache invalidated on step.)
4. Switch to a different frame in the Call Stack view → click Copy as JSON on a variable that was previously cached on the current frame → re-evaluates (Call Stack frame switch invalidates).
5. Click Copy as JSON twice within 100 ms → only one final clipboard write occurs (the second click cancels the first). Trace shows two `evaluate (...)` lines and one `cancelled` line.
6. First-ever invocation on a fresh install: no modal-ish dialog. Output channel contains the one-time disclosure note. Status bar briefly shows the per-invocation reminder.
7. Setting `showSideEffectReminder: false` → no per-invocation reminder; output-channel disclosure still fires once on first invocation.
8. Session ends and a new debug session starts → cache is cold; first invocation re-evaluates.
9. Existing PBI-002, -003, -004 unit tests pass without modification.
10. `npm run test:integration` against the bumped floor (1.90.0) activates cleanly. Activation-smoke output contains no `CANNOT use API proposal: debugFocus` line. (Engine-floor honor check, paired with the corresponding decision-table row.)

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | Copy a variable. Copy unrelated text from elsewhere. Copy the same variable again. | Second copy is instant; clipboard has the JSON; no toast. |
| 2 | Step over. Copy same variable. | Re-evaluates (visible in trace as a fresh `evaluate (...)` line). |
| 3 | Spam-click the same variable's menu 5 times. | Exactly one clipboard write completes; clipboard contains the latest variable's JSON; trace shows cancellations. |
| 4 | Fresh install: first Copy as JSON invocation. | No info dialog. Output channel has a one-line disclosure. Status bar flashes reminder. |
| 5 | Set `showSideEffectReminder` to `false`. Trigger Copy as JSON. | No status-bar reminder. Output-channel disclosure still appears once on first ever invocation. |
| 6 | End session, restart debugger, copy same variable name on first hit. | Re-evaluates (cache is session-scoped). |
| 7 | Pause at frame A, copy `parent.child`. Click frame B in Call Stack, copy `local`. Click frame A again, copy `parent.child`. | Step 3 re-evaluates because Call Stack frame switching invalidates the entry. |
| 8 | Pause at frame A, copy `parent.child`. Copy `parent`. | Both hit the adapter (different expressions); both subsequently cached. |

## Telemetry

None.
