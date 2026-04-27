# PBI-010: Real-debugger end-to-end test harness

## Status

**Completed in v0.1.0.** Opt-in real-debugger E2E harness (`RUN_E2E=1`) with C# sample fixture, clipboard JSON assertions, and trace mirroring for diagnostics. Local-only by design; not gated in CI.

| Phase | Items | Status |
|---|---|---|
| 1 (fixture) | `test-fixtures/csharp-sample` console project with a deliberately-tricky `Person` object (nested record, list, dictionary, embedded quotes, unicode, embedded newlines) | Done in this PR |
| 1 (harness) | `runIntegration.ts` extended to install `ms-dotnettools.csharp` into the test profile, build the fixture, and open the fixture as the test workspace when `RUN_E2E=1` | Done in this PR |
| 1 (happy-path test) | `copyAsJson.e2e.test.ts` starts a real `coreclr` session, hits a breakpoint, programmatically constructs an `IVariablesContext` from the focused frame's locals, invokes the command, asserts the clipboard matches the expected JSON | Done in this PR |
| 1 (PBI-003 promotion) | E2E asserts `csharpDebugCopyAsJson.trace` shows `clipboard, hover, repl` against the real adapter (which advertises `supportsClipboardContext`) | Done in this PR |
| 2 (CI integration) | Separate GitHub Actions job that provisions `dotnet`, installs `ms-dotnettools.csharp`, runs e2e | **Deferred.** The C# extension's Marketplace ToS makes automated install in CI brittle (rate-limited, IP-gated, requires accepting EULA). Tracked as a future PBI; for now the e2e suite is local-only with `RUN_E2E=1` opt-in. |
| 2 (PBI-004 promotion) | E2E asserts that pressing Continue mid-flight produces the canonical `SESSION_MOVED_MESSAGE` toast | **Deferred.** Driving a step or Continue at a precise await boundary from the test process is racy enough that any assertion would be more flake than signal. The decision logic itself remains exhaustively unit-tested via `checkFrameStability`. |

## Goal

Close the coverage gap left by PBI-003 and PBI-004's deferred fake-DAP plans. Both PBIs marked their end-to-end ACs as ⚠️ because driving a real or fake debug session from the test host required significant scaffolding. This PBI provides that scaffolding once, against a real `coreclr` session, so future PBIs touching the debug path can lean on it.

## Scope

In:

- A small .NET console fixture (`net9.0`, single file) with one `Person` instance that exercises every C# JSON serialization edge we care about: nested record, generic `List<string>`, `Dictionary<string, int>`, embedded `"` quotes, unicode escapes, embedded `\n` literals.
- An e2e test suite gated by `RUN_E2E=1` (mocha `this.skip()` when unset, so default `npm test` is unaffected).
- Test-host setup that installs `ms-dotnettools.csharp` into the test profile via the VS Code CLI's `--install-extension`, builds the fixture via `dotnet build`, and opens the fixture as the workspace.
- One happy-path test that asserts the clipboard contains valid JSON whose parsed shape matches the fixture object verbatim.
- Trace-channel assertion that confirms `clipboard, hover, repl` is the chosen evaluate-context order against the real adapter (promotes PBI-003's ⚠️ AC to ✅).

Out:

- CI integration. See deferred row above.
- Driving step/Continue at precise await boundaries to assert PBI-004's race scenarios.
- Multi-platform fixture matrix.
- Newtonsoft.Json fallback path (fixture intentionally has only `System.Text.Json`).

## Architectural decisions

| Decision | Reasoning |
|---|---|
| `RUN_E2E=1` env-var gate, not a separate test runner | Lowest friction for contributors. `npm test` stays fast and offline; opt-in for the heavy path. |
| Install `ms-dotnettools.csharp` into the test profile via VS Code CLI | The test-electron profile is hermetic; it does not see the user's installed extensions. We install from Marketplace at test setup so the test runs against the same adapter the user will use in production. The C# extension's EULA permits Marketplace install for personal use; we do not bundle or redistribute it. |
| Programmatically construct `IVariablesContext` instead of driving the UI | The variables context menu cannot be invoked by `vscode.commands.executeCommand`; it requires a real right-click in a focused tree. Faking the menu would test the menu, not the command. We construct the same `IVariablesContext` that VS Code passes to the menu callback (`{sessionId, container, variable}`) by reading the focused frame's scopes/variables via `customRequest`, which is exactly what the menu does internally. |
| Local-only initially, deferred CI | The Marketplace install path is rate-limited and historically flaky in CI (IP gating, ToS acceptance). A green CI signal that occasionally fails for non-code reasons is worse than no signal. Adds noise and trains contributors to ignore failures. We'll add a CI job in a follow-up PBI when we have a stable path. |
| `net9.0` target framework | Matches the locally-installed SDK (`9.0.300`). A `global.json` could pin an older SDK but adds friction; if a contributor has a different SDK we'll add `<RollForward>LatestMajor</RollForward>` then. |
| Fixture lives in `test-fixtures/csharp-sample/`, not under `src/test/` | Keeps the C# project out of TypeScript include paths and out of `eslint`'s glob. Build artifacts (`bin/`, `obj/`) live under the fixture and are gitignored locally. |

## Acceptance criteria

- `RUN_E2E=1 npm run test:integration` builds the fixture, installs `ms-dotnettools.csharp` (no-op on subsequent runs), launches a real `coreclr` session against the fixture, and asserts:
  - `vscode.env.clipboard.readText()` returns valid JSON.
  - `JSON.parse(clipboardText)` deep-equals the fixture's `Person` object including unicode, embedded quotes, nested record, list, and dictionary.
  - The trace channel contains `evaluate contexts = clipboard, hover, repl` (promotes PBI-003 ⚠️ → ✅).
- `npm test` (no `RUN_E2E`) skips the e2e suite cleanly and the existing 70 unit + 2 integration tests still pass.
- `pbi-005-…md` Phase 2 fake-DAP row updated to point at this PBI as the resolution.
- `pbi-003-…md` ⚠️ AC promoted to ✅ with a back-reference to this PBI's e2e assertion.

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | `RUN_E2E=1 npm run test:integration` on a clean checkout (first run) | Builds fixture, downloads & installs C# extension into test profile, runs e2e; total runtime under 3 minutes; passes. |
| 2 | Same command on a warm checkout | Skips downloads; under 60 seconds; passes. |
| 3 | `npm test` without `RUN_E2E` | E2E suite shows as pending (skipped); 70 unit + 2 integration pass. |
| 4 | `RUN_E2E=1 npm run test:integration` on a machine without `ms-dotnettools.csharp` available on Marketplace (e.g. offline) | Fails fast with a clear "failed to install ms-dotnettools.csharp" error from the install step. |
| 5 | `RUN_E2E=1 npm run test:integration` without `dotnet` on PATH | Fails fast with "failed to build the C# fixture; ensure dotnet SDK is installed". |

## Telemetry

None.

## Notes for future PBIs

- The CI integration row is the obvious next PBI. It needs: `actions/setup-dotnet@v4`, a Marketplace token (or a fallback to OpenVSX's `muhammad-sammy/csharp` fork — note the explicit trade-off vs. testing against the real extension), `xvfb-run` already wired, and a separate workflow job so a flake in e2e doesn't block PRs that only touch utility modules.
- PBI-004's race-scenario ACs are not promotable here. The honest fix is either (a) instrument `extension.ts` with a test-only hook that lets the test inject a delay between awaits, or (b) accept that those scenarios are manual UAT forever. Neither is in scope for PBI-010.
