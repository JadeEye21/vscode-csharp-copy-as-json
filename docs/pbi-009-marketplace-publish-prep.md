# PBI-009: Marketplace publish prep

## Status

Proposed. Derived from code review of `v0.0.1` (D1, D2, D3, D4, supply-chain note on `uuid`).

## Goal

Prepare a `0.1.0` build that can ship to the VS Code Marketplace without embarrassment: accurate README, proper marketplace metadata, an icon, and a clean dependency tree without forward-dated overrides.

## Scope

In:

- **D1.** Correct the README section that implies the extension handles arbitrarily large objects. Document the per-attempt timeout and the truncation behavior PBI-002 will surface.
- **D2.** Document the `csharpDebugCopyAsJson.allowedDebugTypes` setting and how it relates to the `when` clause on the menu (today the README implies the setting is the only gate).
- **D3.** Move the `[Unreleased]` section of `CHANGELOG.md` into a `0.1.0` heading on release; restore an empty `[Unreleased]` skeleton.
- **D4.** Add an icon (128x128 PNG, low-noise; placeholder in `media/icon.png`), a `categories` array (`Debuggers`, `Other`), `keywords` (`csharp`, `dotnet`, `debug`, `json`, `clipboard`), `repository`, `bugs`, `homepage` fields in `package.json`.
- **`uuid` override.** Re-evaluate the `"uuid": "^14.0.0"` entry in `package.json` `overrides`. If the upstream `@vscode/vsce` 3.x has caught up by publish time, drop it. If it has not, document why we keep it.
- Dry-run the publish via `vsce package --no-dependencies` and `vsce ls`, sanity-check the file list.
- Bump version to `0.1.0` in `package.json` and tag accordingly (release flow already handled by existing workflow + PBI-007).

Out:

- Actually publishing to the Marketplace. That decision is the maintainer's, not this PBI's.
- Localized README. Future work.

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Ship as `0.1.0`, not `0.0.2` | Signals "first publish-quality build" without claiming `1.0`. |
| Drop `uuid` override if possible | Pinning transitive deps is technical debt; only keep when justified. |
| Single PNG icon, no SVG | Marketplace requires a PNG; SVG is rasterized anyway. |

## Acceptance criteria

- README sections on size limits, timeouts, and the `allowedDebugTypes` setting reflect the actual behavior.
- `CHANGELOG.md` has a populated `0.1.0` section.
- `package.json` includes `icon`, `categories`, `keywords`, `repository`, `bugs`, `homepage`.
- `vsce package --no-dependencies` produces a `.vsix` whose file list contains no `src/`, no `samples/`, no `node_modules/` (extends the work in `.vscodeignore`).
- The `overrides` block either no longer contains `uuid` or contains a comment explaining why.
- A new `v0.1.0` tag triggers the release workflow and produces a `.vsix` attached to a GitHub Release. (Marketplace publish is a separate manual step.)

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | Read the README end-to-end | No claims that contradict observed behavior in PBI-001 / PBI-002. |
| 2 | Open the `.vsix` from the GitHub Release in `unzip -l` | No `src/`, `samples/`, or test files. |
| 3 | Install the `.vsix` in a fresh VS Code profile | Icon appears in Extensions sidebar; categories filter finds it under **Debuggers**. |
| 4 | `npm audit --omit=dev` | Zero vulnerabilities. |

## Telemetry

None.
