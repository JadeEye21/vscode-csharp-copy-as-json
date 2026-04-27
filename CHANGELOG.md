# Changelog

All notable changes to **Copy as JSON (C# Debug)** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Add an icon (128x128 PNG).
- Mirror the command on `debug/watch/context`.
- Optional chunked retrieval for very large objects via `variablesReference` traversal.

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
