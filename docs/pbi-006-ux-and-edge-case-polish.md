# PBI-006: UX polish and edge-case messaging

## Status

Proposed. Derived from code review of `v0.0.1` (R2, R3, R4, S1).

## Goal

Tighten the user-facing strings and recover from a handful of edge cases gracefully. Individually small; together they remove most of the "what just happened?" moments in the current build.

## Scope

In:

- **R2 / "View Logs" without trace.** Either always log errors (sanitized: command, target shape, last-context attempted, error message) so the **View Logs** button is always useful, or hide the button when `csharpDebugCopyAsJson.trace` is `false`.
- **R3 / Ref-struct refusal.** When `variable.type` matches `^(System\.)?(Span|ReadOnlySpan|Memory|ReadOnlyMemory|Utf8JsonReader|Utf8JsonWriter)<`, refuse with a clear message ("Cannot serialize ref-struct types") instead of issuing an evaluate that the JIT will reject.
- **R4 / Side-effect dialog wording.** Re-word the buttons so they are not redundant. Proposed: **OK** + **Don't show again**. Also stop showing the dialog at all when the active session was launched with `noDebug: true` (we are not actually pausing for them).
- **S1 / Codicon.** Change the menu icon from `$(clippy)` to `$(copy)` (Clippy is unsanctioned in the contrib guidelines).
- Centralize all user-facing strings in a `messages.ts` constant map so that the existing tests can assert on them without hard-coding strings in the producer.

Out:

- Localization (`l10n`) wiring; would be nice but is its own PBI.
- New telemetry. Still none.

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Always-log over hide-button | Diagnostics are cheap; one-line log per failure does not pollute. |
| Ref-struct refusal is a name match | The DAP `Variable.type` is the cheapest signal we have; perfect detection requires reflection we cannot do. |
| Centralized messages module | Lets PBI-005 integration tests assert wording without false positives from i18n. |

## Acceptance criteria

- View Logs button reveals a relevant entry for any failed invocation, even with `trace: false`.
- Right-clicking a `Span<int>` produces "Cannot serialize ref-struct types"; no evaluate is issued.
- Side-effect dialog has two distinct buttons; running with `noDebug: true` skips it entirely.
- Menu uses `$(copy)`.
- Existing tests updated to import message constants instead of hard-coded strings.

## UAT checklist

| # | Scenario | Expected result |
|---|---|---|
| 1 | Trigger any failure with `trace: false`, then click **View Logs** | Output channel contains a one-line entry naming the failure. |
| 2 | Right-click a `Span<int>` local | Refusal toast; no clipboard write. |
| 3 | First-use side-effect dialog | Two clearly distinct buttons; pressing **Don't show again** prevents re-display. |
| 4 | Launch with `noDebug: true`, trigger Copy as JSON | No side-effect dialog. |
| 5 | Inspect menu icon | `$(copy)`, not `$(clippy)`. |

## Telemetry

None.
