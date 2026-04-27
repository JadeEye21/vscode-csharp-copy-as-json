# PBI-012 — Trace and silence DEP0005 `Buffer()` deprecation in the e2e test host

Status: Proposed
Filed: 2026-04-27 (during PBI-011 implementation)

## Problem

When running the integration suite with `RUN_E2E=1` against stable VS Code
(observed on 1.117.0) with the `ms-dotnettools.csharp` extension installed,
the extension host prints once at startup:

```
(node:10894) [DEP0005] DeprecationWarning: Buffer() is deprecated due to
security and usability issues. Please use the Buffer.alloc(),
Buffer.allocUnsafe(), or Buffer.from() methods instead.
(Use `Code Helper (Plugin) --trace-deprecation ...` to show where the
warning was created)
```

The warning is benign today but `DEP0005` is on Node's roadmap to become a
hard error in a future major. When it flips, the test host (and every
end-user host on the same Node) will fail to start.

## What is NOT the source (already ruled out, 2026-04-27)

- **Our `src/`**: `rg "new Buffer\\("` across `src/` returns no matches.
- **VS Code 1.90.0** (the new engine floor after PBI-011): activation smoke
  ran with `NODE_OPTIONS='--trace-deprecation'` and emitted **no** DEP0005.
  So the offender is something present in newer VS Code or in the loaded
  C# extension chain, but not in 1.90.

## Likely sources (to confirm in PBI-012 spike)

In order of decreasing probability based on what differs between the 1.90
activation-smoke run and the 1.117 e2e run:

1. **`ms-dotnettools.csharp` itself** (or one of its bundled JS deps:
   Roslyn LSP client, debugger glue, `vscode-languageclient`, etc.).
2. **`ms-dotnettools.vscode-dotnet-runtime`**, which is auto-pulled by the
   C# extension.
3. **VS Code 1.117 internals** — possible but unlikely; Microsoft's own
   lint catches `new Buffer()` in core.
4. **A devDependency of ours that loads only in the e2e harness path**
   (e.g. something inside `@vscode/test-electron`'s extension-host
   bootstrap) — also unlikely; the warning fires *inside* the host
   process, not the runner.

## Goals

- (G1) Identify the exact offender with a stack trace.
- (G2) If the offender is ours, fix it by replacing `new Buffer(...)` with
  `Buffer.from / Buffer.alloc / Buffer.allocUnsafe`.
- (G3) If the offender is upstream, file an issue on the offending repo
  and link it from this PBI. **Do not** patch or vendor the offender.
- (G4) Make `--trace-deprecation` permanent for the e2e harness so the
  next deprecation does not require this investigation re-work.

## Out of scope

- Suppressing `DEP0005` globally via `--no-deprecation`. We want to know
  when it changes status.
- Rewriting unrelated `Buffer()` usages in `node_modules/` (transitive
  deps that happen to also use it but did not trigger this warning).

## Architectural decisions

- Add `NODE_OPTIONS=--trace-deprecation` (or the per-process equivalent)
  to the `extensionTestsEnv` in `runE2e()` permanently. The activation
  smoke path can stay clean since it does not currently reproduce.
- Capture the trace from a clean `RUN_E2E=1` run, identify the topmost
  user-or-extension frame, and decide G2 vs. G3 from that frame.
- If G3: the upstream issue link goes in the **Status** header of this
  doc (e.g. `Status: Filed upstream — microsoft/vscode-csharp#NNNN`),
  and we add a Mocha output filter so the warning does not pollute CI
  logs while we wait for the upstream fix. The filter must match
  precisely the DEP0005 line so it cannot mask a different deprecation.

## Acceptance criteria

- [ ] AC1 — A `RUN_E2E=1` run on the same VS Code/C#-extension versions
      where the warning was originally observed produces a stack trace
      that names the offending file or extension. Trace pasted into this
      doc as evidence.
- [ ] AC2 — Either:
      (a) the offender is in our code or our direct deps and is fixed
          (warning gone), OR
      (b) an upstream issue is linked from the **Status** header and
          the warning is suppressed in CI output by a precise Mocha
          reporter filter (with comment justifying scope).
- [ ] AC3 — `runIntegration.ts` permanently passes `--trace-deprecation`
      to the e2e extension host so a future deprecation does not require
      a separate spike.

## UAT checklist

- [ ] `RUN_E2E=1 npm run test:integration` produces no `DEP0005` line in
      stdout.
- [ ] If suppression is in place rather than a real fix, manually
      verify that flipping the suppression off still prints exactly the
      one expected warning, and that an unrelated injected
      `process.emitWarning('test', 'DeprecationWarning')` is NOT
      suppressed.

## Telemetry

None.

## References

- DEP0005 (Buffer constructor): https://nodejs.org/api/deprecations.html#DEP0005
- Original repro: terminals/1.txt:998-1001 (RUN_E2E=1 run on 2026-04-27).
- Negative result on 1.90 activation smoke: this branch's
  `npm run test:integration` with `NODE_OPTIONS='--trace-deprecation'`
  on 2026-04-27 — no DEP0005 emitted.
