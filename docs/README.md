# PBI index

| PBI | Title | Status | Notes |
|---|---|---|---|
| [001](./pbi-001-copy-as-json.md) | Copy variable as JSON during C# debugging | Implemented in `v0.0.1`, awaiting UAT | The original feature. |
| [002](./pbi-002-validate-evaluate-result.md) | Validate evaluate result before clipboard write | Proposed | Closes review item C1; depends on nothing. |
| [003](./pbi-003-stable-capability-detection.md) | Stable detection of `supportsClipboardContext` | Proposed | Closes review item C3; depends on nothing. |
| [004](./pbi-004-frame-stability-across-dialogs.md) | Re-validate stack frame after the side-effect warning | Proposed | Closes review item C2; depends on nothing. |
| [005](./pbi-005-activation-integration-tests.md) | `@vscode/test-electron` harness | Proposed | Foundational; unblocks automated AC for PBI-002/003/004. |
| [006](./pbi-006-ux-and-edge-case-polish.md) | UX polish and edge-case messaging | Proposed | Bundles R2 / R3 / R4 / S1. |
| [007](./pbi-007-workflow-supply-chain-hardening.md) | Workflow and supply-chain hardening | Proposed | SHA-pin actions, scope perms, enforce zero runtime deps. |
| [008](./pbi-008-type-checked-eslint.md) | Adopt type-checked ESLint preset | Proposed | Lint upgrade; depends on PBI-005 only if you want lint failures to block CI on test files. |
| [009](./pbi-009-marketplace-publish-prep.md) | Marketplace publish prep (`0.1.0`) | Proposed | Should land **after** 002/003/004 and 005. |

## Suggested order of work

1. **PBI-005** first - the test harness unblocks credible acceptance criteria for the rest.
2. **PBI-002**, **PBI-003**, **PBI-004** in parallel - the three criticals; small, independent.
3. **PBI-007** and **PBI-008** in parallel - infrastructure work that has no user-visible risk.
4. **PBI-006** - UX polish, batches well with whichever of 002/003/004 lands last.
5. **PBI-009** - the publish-prep PBI; should be the last one merged before tagging `v0.1.0`.
