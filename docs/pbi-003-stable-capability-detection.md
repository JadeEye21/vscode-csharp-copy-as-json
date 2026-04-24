# PBI-003: Stable detection of `supportsClipboardContext`

## Status

**In progress.** Production code and unit tests delivered on `feature/pbi-003-stable-capability-detection`.

| Phase | Items | Status |
|---|---|---|
| 1 (replace cast) | `clipboardCapability` cache, `DebugAdapterTracker` registration, `onDidTerminateDebugSession` eviction, `onDebug` activation event, removal of the `as unknown as` cast | Done in this PR |
| 1 (unit coverage) | 16 tests over the cache + tracker message-extraction logic | Done in this PR |
| 2 (fake-DAP integration test) | Drive a fake `DebugAdapterInlineImplementation` end-to-end and assert the tracker→cache wiring | **Deferred again.** See "Deviations" below. |

## Goal

Stop relying on the duck-typed `(session as any).capabilities.supportsClipboardContext` access. The `capabilities` field is not part of `vscode.DebugSession`'s public API; it happens to exist on the current implementation. A future VS Code release that hides the field will silently demote every user to the `hover -> repl` path and re-introduce the truncation bug PBI-002 is fixing.

## Scope

In:

- Replace the cast with a public mechanism. Two acceptable options:
  1. Probe-then-fallback: try `evaluate` with `context: 'clipboard'` first, and on `Capability not supported` / `unrecognized context` errors fall through to `hover`.
  2. `vscode.debug.registerDebugAdapterTrackerFactory` to read `InitializeResponse.body.supportsClipboardContext` from the wire.
- Cache the resolved capability per session (keyed by `session.id`) to avoid paying the probe cost on every invocation.
- Invalidate the cache on `onDidTerminateDebugSession`.

Out:

- Removing the `clipboard` context entirely. We still want it when supported.
- Reworking the rest of the context fallback chain (covered by PBI-002).

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Prefer the tracker over probe-and-fallback | One round trip cheaper, and the answer is authoritative. |
| Per-session cache, not per-extension | The user can have multiple debug sessions with different adapters; a global cache would be wrong. |
| Keep `clipboard` as the first preference when supported | Mirrors VS Code's built-in "Copy Value" behavior (decision carried over from PBI-001). |
| Register the tracker for `'*'`, not for `coreclr`/`clr` | The user can override `csharpDebugCopyAsJson.allowedDebugTypes` to add e.g. `mono` or `unity`. A no-op tracker on unrelated sessions costs one closure per session; that's cheaper than silently losing the capability when a non-default debug type is added. |
| Add `activationEvents: ["onDebug"]` | Without it, the extension activates lazily on first command invocation - which happens *after* the user right-clicks a variable, well after `InitializeResponse`. The tracker would never see the response, the cache would always be empty, and `pickEvaluateContexts` would always return `['hover','repl']`, regressing PBI-001's clipboard-context support. |
| Cache miss is treated as `false` (not `true`) | If the tracker missed for any reason, falling through to `hover` is correct on every adapter. Defaulting to `true` would attempt `clipboard` on adapters that reject it and surface a noisy error. |
| Extracted the tracker logic into `createCapabilityTracker(sessionId)` | The message-extraction logic is the only thing worth testing; isolating it as a pure function lets the unit suite exercise every shape (success, failure, missing field, wrong command, event, junk) without needing an Electron host or fake adapter. |

## Deviations from original plan

- **Fake-DAP integration test deferred.** Driving a real `vscode.debug.startDebugging` call against a `DebugAdapterInlineImplementation` requires either contributing a `debuggers` entry in `package.json` (which would pollute the published Marketplace package with a "csharp-copy-test" debug type) or shipping a `DebugConfigurationProvider` shim with similar concerns. The cost - measured in package surface, not test code - is high relative to what it adds beyond the already-comprehensive unit coverage of `createCapabilityTracker`. The remaining untested surface is two lines of glue (`vscode.debug.registerDebugAdapterTrackerFactory` + `onDidTerminateDebugSession`), which is covered by manual UAT instead. If future PBIs (especially PBI-004's frame-stability work) need a fake adapter for their own reasons, we'll bundle a test-only `package.json` `debuggers` contribution then and retroactively add the integration assertion here.

## Acceptance criteria

- ✅ No `as any` / `as unknown as` casts on `vscode.DebugSession` anywhere in `extension.ts`.
- 🔲 Manual run on VS Code 1.89, current stable, and current insiders: clipboard context is chosen exactly when the adapter advertises it. *(Manual UAT, owner: PR author.)*
- ✅ Adapter that never sends `supportsClipboardContext` results in `hover -> repl` being attempted, not a crash. *(Covered by the unit test "caches false when InitializeResponse omits supportsClipboardContext" combined with the cache-miss=false rule in `pickEvaluateContexts`.)*
- ⚠️ Test asserts that a session whose tracker received `supportsClipboardContext: false` does not attempt a `clipboard` evaluate. *(Asserted at the cache-API level: the tracker writes `false`, and `pickEvaluateContexts` reads from the cache and excludes `'clipboard'` from the returned context list. The end-to-end `evaluate` call is not driven by an automated test - see "Deviations".)*

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | C# debug session, `coreclr`, default adapter | Trace logs show `clipboard` attempted first. |
| 2 | C# debug session against an adapter forced to omit `supportsClipboardContext` | Trace logs show first attempt is `hover`; clipboard is never tried. |
| 3 | Two concurrent sessions with different capabilities | Each respects its own cached value. |
| 4 | Restart VS Code, start a fresh session | Cache is empty; capability is resolved on first invocation. |

## Telemetry

None.
