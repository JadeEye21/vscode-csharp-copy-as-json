# PBI-007: Workflow and supply-chain hardening

## Status

**Completed in v0.1.0–v0.1.1.** Groundwork shipped in v0.1.0 (lockfile, Dependabot for npm + GitHub Actions, `npm install --omit=optional` in workflows, batch dependency upgrades, `.vscodeignore` for leaner VSIX, Node 24 for first-party Actions, `test:unit`-only release jobs). Real-VS-Code activation-smoke gate added to `release.yml` in v0.1.1 so a build that fails to activate can no longer reach a GitHub Release.

## Goal

Reduce the blast radius of a compromised third-party action and prevent runtime dependencies from sneaking into the published `.vsix`.

## Scope

In:

- **W1 / SHA-pin third-party actions.** Replace `softprops/action-gh-release@v3` (and any other non-GitHub-owned action we add later) with a 40-char commit SHA + version comment. `actions/checkout` and `actions/setup-node` are GitHub-owned and may stay on `vN`.
- **W2 / Scoped permissions.** `release.yml`'s top-level `permissions: contents: write` is broad. Move the `write` to the `release` job only; default the rest of the workflow to `permissions: read-all` (or per-job `contents: read`).
- **W4 / Dependabot for GitHub Actions.** Confirm the `github-actions` ecosystem is enabled in `dependabot.yml`. SHA pins make Dependabot more useful, not less.
- **R6 / `--no-dependencies` enforcement.** Update the `vscode:prepublish` script (or add a thin wrapper in CI) so that any non-`devDependencies` entry in `package.json` causes the package step to fail loudly. The intent is "this extension has zero runtime deps" and the build should enforce it.
- Document the policy in `docs/release.md` (new file): which actions are pinned, how to bump them, why we use `npm install --omit=optional` in CI.

Out:

- Provenance / SLSA attestations on the `.vsix`. Worth doing, but is its own PBI.
- Sigstore signing of the `.vsix`. Same.

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Pin only third-party actions | First-party actions are signed and rotated by GitHub itself; pinning them just creates upgrade churn. |
| Per-job permissions | Smaller blast radius; matches GitHub's own recommendation. |
| Build-time guard, not just convention | "Don't add runtime deps" is the kind of rule that decays without enforcement. |

## Acceptance criteria

- `softprops/action-gh-release` (and any future third-party action) is referenced by full SHA with `# vX.Y.Z` comment.
- `release.yml` has no top-level `permissions: contents: write`. Only the publishing job has write scope.
- A test commit that adds a runtime dep to `package.json` causes the package step to fail with a readable message.
- Dependabot opens PRs for both `npm` and `github-actions` ecosystems.
- `docs/release.md` exists and is linked from `README.md`.

## UAT checklist

Not user-facing; covered by green CI on a follow-up PR that intentionally adds a runtime dep (then reverts).

## Telemetry

None.
