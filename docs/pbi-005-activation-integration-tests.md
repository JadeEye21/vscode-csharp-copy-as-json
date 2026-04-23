# PBI-005: Activation and integration test harness via `@vscode/test-electron`

## Status

Proposed. Derived from code review of `v0.0.1` (test-coverage gap T1, prerequisite for PBI-002/003/004 acceptance tests).

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

## Acceptance criteria

- `npm test` runs both the existing unit tests and the new electron-based integration tests locally.
- CI runs the electron tests in a headless Linux job and they pass.
- Coverage report (text summary, no upload) shows non-zero coverage for `extension.ts`.
- PBI-002, PBI-003, PBI-004 can express their acceptance criteria as automated tests in this harness.

## UAT checklist

Not user-facing; covered by green CI.

## Telemetry

None.
