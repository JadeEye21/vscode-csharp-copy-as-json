# Changelog

All notable changes to **Copy as JSON (C# Debug)** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Add an icon (128x128 PNG).
- Mirror the command on `debug/watch/context`.
- Optional chunked retrieval for very large objects via `variablesReference` traversal.
- PBI-006 user-visible polish (ref-struct refusal, codicon, centralized message strings, `noDebug` skip).

## [0.2.0] - 2026-04-27

### Breaking

- **Engine floor bumped from `^1.89.0` to `^1.90.0`.** The cache invalidation in PBI-011 / C2 subscribes to `vscode.debug.onDidChangeActiveStackItem` at activation time, and that event (along with the `vscode.debug.activeStackItem` property used since PBI-004) is part of the `debugFocus` proposal that VS Code only finalized in 1.90.0 (microsoft/vscode#212190, May 2024). On 1.89.x the activation throws and the extension fails to load. The matching workflow-level `VSCODE_TEST_VERSION` and the `runIntegration.ts` `DEFAULT_VSCODE_VERSION` are bumped in lockstep so the activation-smoke gate continues to run against the actual floor. **Action required for users on VS Code 1.89.x: upgrade to 1.90.0 or later.** This also incidentally fixes a latent issue in 0.1.x where invoking **Copy as JSON** on a 1.89.x host would have thrown at command-time on the `vscode.debug.activeStackItem` read (the floor was advertised as 1.89 but the API only became stable in 1.90).

### Changed

- **Real-time re-copy via frame-scoped cache.** Re-copying the same variable on the same paused frame is now served from an in-memory cache keyed by `(sessionId, threadId, frameId, expression)`. No DAP round-trip, no extra side effects. The cache is invalidated on `onDidChangeActiveStackItem` (step / continue / Call Stack frame switch) and on `onDidTerminateDebugSession` (PBI-011 / C1, C2).
- **Cancel-and-replace dispatch.** Clicking **Copy as JSON** while a previous evaluate is still in flight now cancels the previous via `CancellationTokenSource` and starts the new one. The "Copy as JSON is already running for the previous variable" toast is removed entirely. Last click wins the clipboard. (PBI-011 / C3.)
- **Per-session winning-context memo.** The first DAP `evaluate` context (`clipboard` / `hover` / `repl`) that returns a parseable result for a session is tried first on subsequent invocations in that session; on session terminate the memo is cleared. Cuts cold-path latency for everything after the first variable. (PBI-011 / C4.)
- **Non-blocking side-effect notice.** The first-use modal-ish information dialog is replaced by (a) a one-time disclosure line appended to the **Copy as JSON** output channel on first invocation per install (gated by the existing `globalState` key, so upgrading users who already dismissed the dialog do not see the disclosure again), and (b) a per-invocation transient status-bar reminder controllable by the new `csharpDebugCopyAsJson.showSideEffectReminder` setting. (PBI-011 / C5.)
- **Status-bar dispatch feedback.** Every invocation immediately shows a `$(sync~spin) Copy as JSON…` status-bar message that is cleared on success, cache hit, failure, or cancel. Cache hits and evaluate successes show distinct success messages so the cache is observable. (PBI-011 / C6.)

### Added

- New setting `csharpDebugCopyAsJson.showSideEffectReminder` (default `true`).
- New module `src/util/resultCache.ts` (`ResultCache` class) with full unit-test coverage for `put` / `get` / `clearThread` / `clearSession` / `clearAll`, including key-collision and overlapping-numeric-prefix edge cases.

### Removed

- The `inFlight` boolean and the `Copy as JSON is already running` information toast.
- The `maybeShowSideEffectWarning` modal information dialog and the post-warning `captureFrame` re-validation step. With no awaitable dialog between target resolution and the evaluate loop, the captured frame is still re-validated per attempt by the existing `checkFrameStability` gate (PBI-004), which is unchanged.

## [0.1.1] - 2026-04-27

### CI

- Release pipeline now downloads real VS Code 1.89 and runs the activation
  smoke test (under `xvfb-run`) before publishing the VSIX, so a build that
  fails to activate can no longer reach a GitHub Release. The
  `RUN_E2E=1` real-coreclr-debugger test stays local-only by design.
- Cache `.vscode-test/` in the release workflow (matches `ci.yml`) and
  surface `VSCODE_TEST_VERSION` at the workflow level.


## [0.1.0] - 2026-04-27

### Added

- Opt-in real-debugger E2E harness (`RUN_E2E=1`) with a C# sample fixture, clipboard JSON assertions, and trace mirroring for diagnostics (PBI-010).
- `@vscode/test-electron` integration harness with activation smoke tests wired into CI (PBI-005).
- Marketplace-oriented `package.json` metadata (`categories`, `keywords`, `repository`, `bugs`, `homepage`) and README clarifications for limits, timeouts, and `allowedDebugTypes` (PBI-009).

### Changed

- Validate DAP evaluate results with `JSON.parse` after unescaping; reject truncation and error-shaped strings; tighten `looksLikeError` false positives (PBI-002).
- Detect `supportsClipboardContext` from `InitializeResponse` via `DebugAdapterTracker` with a per-session cache; activate on `onDebug` so the tracker runs before first use (PBI-003).
- Re-capture the stack frame after the side-effect warning and re-validate session/frame before each evaluate attempt; canonical session-moved user message (PBI-004).
- UX polish from code review (ref-struct refusal, codicon, centralized strings, `noDebug` side-effect skip) remains documented for follow-up; no extension behavior change for those items in this release (PBI-006).
- Type-checked ESLint (`recommendedTypeChecked`) remains planned; lint still uses the recommended TypeScript preset (PBI-008).

### CI

- Lockfile and reproducible installs, Dependabot for npm and GitHub Actions, `npm install --omit=optional` in workflows, dependency batch upgrades, `.vscodeignore` for leaner VSIX, Node 24 for first-party Actions, and release jobs that run `npm run test:unit` only so tagged builds do not pull integration/E2E (PBI-007 groundwork).

## [0.0.1] - 2026-04-23

### Added

- Initial release.
- `Copy as JSON` command contributed to the `debug/variables/context` menu.
- Capability-aware DAP `evaluate` context fallback (`clipboard` &rarr; `hover` &rarr; `repl`).
- `System.Text.Json` primary serializer with `Newtonsoft.Json` fallback.
- C# string-literal unescape before clipboard write.
- Settings: `allowedDebugTypes`, `evaluateTimeoutMs`, `preferNewtonsoft`, `trace`.
- Diagnostics output channel (gated by `trace` setting).
- Sample .NET 8 console app under `samples/dotnet-console/` for UAT.
- GitHub Actions CI (lint + compile + unit tests + VSIX artifact) and tag-triggered release workflow.
