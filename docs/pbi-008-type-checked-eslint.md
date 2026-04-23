# PBI-008: Adopt type-checked ESLint preset

## Status

Proposed. Derived from code review of `v0.0.1` (S2).

## Goal

Move from `tsPlugin.configs.recommended` to `tsPlugin.configs.recommendedTypeChecked` so that the linter catches the bugs we actually have - unhandled promises, unsafe `any`, redundant `await` - instead of stopping at syntax-level rules.

## Scope

In:

- Update `eslint.config.mjs`:
  - Add a `parserOptions.project` pointing at `tsconfig.json`.
  - Spread `tsPlugin.configs.recommendedTypeChecked.rules` for `src/**/*.ts`.
  - Re-tune the noisy rules (`no-misused-promises`, `no-floating-promises` stay on; `no-unsafe-*` start as `warn`).
- Fix the resulting findings, in particular any floating promises around `customRequest` and the side-effect dialog.
- Add a separate, lighter override block for tests (no `recommendedTypeChecked`, since Mocha's `suite/test` typings make it noisy).

Out:

- Migrating to `eslint-plugin-import` or `prettier`. Out of scope.
- Replacing the test runner. Still TDD Mocha.

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Type-checked preset for `src`, plain for tests | Tests are the noisiest area for the strict rules and the lowest-value place to enforce them. |
| `no-unsafe-*` as `warn`, not `error` | Lets us land the upgrade without a giant cleanup PR; we can ratchet later. |

## Acceptance criteria

- `npm run lint` runs with `recommendedTypeChecked` and exits clean.
- `no-floating-promises` and `no-misused-promises` are `error`.
- The CI job that runs `lint` is unchanged (no special flags needed).
- A deliberately introduced floating promise in `extension.ts` fails lint locally.

## UAT checklist

Not user-facing.

## Telemetry

None.
