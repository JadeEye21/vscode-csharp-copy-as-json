# PBI-003: Stable detection of `supportsClipboardContext`

## Status

Proposed. Derived from code review of `v0.0.1` (critical C3).

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

## Acceptance criteria

- No `as any` casts on `vscode.DebugSession` anywhere in `extension.ts`.
- Manual run on VS Code 1.89, current stable, and current insiders: clipboard context is chosen exactly when the adapter advertises it.
- Killing the extension's tracker (or running against an adapter that never sends `supportsClipboardContext`) results in `hover -> repl` being attempted, not a crash.
- Unit / integration test asserts that a session whose tracker received `supportsClipboardContext: false` does not attempt a `clipboard` evaluate.

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | C# debug session, `coreclr`, default adapter | Trace logs show `clipboard` attempted first. |
| 2 | C# debug session against an adapter forced to omit `supportsClipboardContext` | Trace logs show first attempt is `hover`; clipboard is never tried. |
| 3 | Two concurrent sessions with different capabilities | Each respects its own cached value. |
| 4 | Restart VS Code, start a fresh session | Cache is empty; capability is resolved on first invocation. |

## Telemetry

None.
