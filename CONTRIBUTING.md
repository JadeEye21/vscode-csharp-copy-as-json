# Contributing

Thanks for your interest! This project is a small, focused VS Code extension. Contributions of any size are welcome.

## Development setup

```bash
git clone https://github.com/JadeEye21/vscode-csharp-copy-as-json.git
cd vscode-csharp-copy-as-json
npm install
npm run compile
npm test
```

Press `F5` in VS Code to launch the **Extension Development Host** with the bundled `samples/dotnet-console` workspace pre-opened.

## Branches and commits

- Work on a feature branch named `feature/<short-slug>` or `fix/<short-slug>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`, `build:`.
- Merge to `main` with `git merge --no-ff` so PRs always produce a merge commit. CI runs on every push and pull request.

## Code style

- TypeScript strict mode, ESLint enforced in CI.
- Prefer pure functions and put them in `src/util/` so they remain unit-testable without a VS Code host.
- Add or update Mocha tests in `src/test/` whenever you change behavior in `src/util/`.

## Filing a bug

Use the **Bug report** issue template and include:

- VS Code version
- Extension version
- Operating system
- The contents of the **Copy as JSON** output channel with `csharpDebugCopyAsJson.trace` enabled (redact secrets)
- A minimal repro project, ideally based on `samples/dotnet-console`

## Releases

Releases are cut from `main`:

```bash
npm version patch # or minor / major
git push --follow-tags
```

The `release.yml` workflow builds a VSIX and uploads it as a GitHub Release asset.
