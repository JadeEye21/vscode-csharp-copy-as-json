# PBI-005: Activation and integration test harness via `@vscode/test-electron`

## Status

**Completed (partial).** Phase 1 (harness + activation smoke) shipped in v0.1.0. Phase 2 fake-DAP coverage remains deferred — tracked in [#25](https://github.com/JadeEye21/vscode-csharp-copy-as-json/issues/25) and will be picked up alongside the PBIs that consume it.

| Phase | Items | Status |
|---|---|---|
| 1 (harness) | `@vscode/test-electron` runner, Mocha glob, activation smoke, CI wiring | Done in PR #13 |
| 2 (utility coverage) | `withTimeout` and `looksLikeError` tests | Done in **PBI-002** PR |
| 2 (fake DAP) | In-process fake adapter exercising success and all-contexts-failed paths | Still deferred. PBI-003 chose to extract its tracker logic into a pure function and unit-test that instead, side-stepping the need for an adapter fake for capability detection. The fake-DAP machinery will land when a PBI actually requires it (likely PBI-004's frame-stability tests) and will be designed against that PBI's specific assertions rather than speculatively. |

Rationale: the harness has its own plumbing risk (test-electron download pinning, headless `xvfb` on Linux, Electron version drift). Landing it on its own keeps any harness-level CI failure attributable instead of blamed on test logic. The fake-DAP work splits naturally with the PBIs that consume it - PBI-002's tests need truncation injection, PBI-003's tests need a tracker that omits `supportsClipboardContext`. Purpose-built fakes beat speculative generalization.

## Goal

Today the test suite covers the two pure utility modules (`expression`, `unescape`) and nothing else. There is no test that the extension activates, that the command is registered under the right `when` clauses, or that a synthetic debug session triggers the code path. We want a thin but real `@vscode/test-electron` harness so that PBI-002/003/004 can land with regression tests instead of just manual UAT.

## Scope

In:

- Add `@vscode/test-electron` and a `runTests` entry point.
- Activation smoke test: load the extension in a downloaded VS Code, assert `csharpDebugCopyAsJson.copy` is in the command palette result.
- `withTimeout` test (currently un-covered) using fake timers.
- `looksLikeError` test (regression coverage for PBI-002).
- A fake `DebugAdapter` (in-process) that:
  - advertises `supportsClipboardContext`,
  - returns canned `evaluate` responses,
  - is enough to drive the success and the "all contexts failed" paths end-to-end.
- Wire the new test entry into `npm test` and CI.

Out:

- A real `coreclr` adapter under CI. Too heavy and platform-dependent.
- Cross-platform matrix (Linux Electron only is fine for now).

## Architectural decisions

| Decision | Reasoning |
|---|---|
| `@vscode/test-electron`, not `@vscode/test-cli` | The extension targets the legacy `--ui tdd` Mocha runner (carried from PBI-001). Switching test runners is out of scope. |
| In-process fake adapter | A real `coreclr` launch would balloon CI time and leak platform-specific issues into the test signal. |
| Only Linux electron in CI | Cheapest signal; the extension is JS, not native. |
| Pin the test-host VS Code to the `engines.vscode` floor (currently `1.89.0`) | If the floor passes, the minimum-supported promise is honored. Override via `VSCODE_TEST_VERSION` env var for ad-hoc runs against `stable` / `insiders`. The pin paid for itself on day one: it caught `glob@11`/`lru-cache@11` calling `node:diagnostics_channel.tracingChannel` (a Node 19+ API) inside VS Code 1.89's Electron 28 / Node 18 host, before that dep ever shipped. |
| Cache `.vscode-test/` keyed by the pinned version | Avoids re-downloading ~120 MB of VS Code on every CI run; cache key invalidates automatically when the pin is bumped. |
| No external `glob` dep in the test runner | A 6-line `fs.readdirSync` walker discovers `*.test.js` and avoids the `glob -> path-scurry -> lru-cache@11` chain that requires Node 19+. We control the test layout, so a globbing library is overkill. |

## Acceptance criteria

- `npm test` runs both the existing unit tests and the new electron-based integration tests locally.
- CI runs the electron tests in a headless Linux job and they pass.
- Coverage report (text summary, no upload) shows non-zero coverage for `extension.ts`.
- PBI-002, PBI-003, PBI-004 can express their acceptance criteria as automated tests in this harness.

## UAT checklist

Not user-facing; covered by green CI.

## Telemetry

None.
