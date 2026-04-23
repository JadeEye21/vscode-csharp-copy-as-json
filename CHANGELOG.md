# Changelog

All notable changes to **Copy as JSON (C# Debug)** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Add an icon (128x128 PNG).
- Mirror the command on `debug/watch/context`.
- Optional chunked retrieval for very large objects via `variablesReference` traversal.

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
