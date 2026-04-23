# Security Policy

## Supported versions

Only the latest minor release is supported with security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

Email <harshal.dhagale@gmail.com> with:

- A description of the vulnerability
- Steps to reproduce or a proof of concept
- The version of the extension and your VS Code version

You will receive an acknowledgement within seven days.

## Scope and threat model

This extension uses the standard VS Code debug API to send a `customRequest('evaluate', ...)` to whichever debug adapter is active. The expression it sends is:

- `System.Text.Json.JsonSerializer.Serialize((object)(<TARGET>), new System.Text.Json.JsonSerializerOptions { WriteIndented = true })`
- `Newtonsoft.Json.JsonConvert.SerializeObject((object)(<TARGET>), Newtonsoft.Json.Formatting.Indented)`

`<TARGET>` is taken from the DAP `Variable.evaluateName` field of the variable the user right-clicked, or constructed from `name` plus the parent watch expression as a fallback. **The user's debug session is the only code-execution surface; the extension itself does not parse or interpret the variable's value.** Treat the action as equivalent to typing the expression into the VS Code Debug Console.

In-scope security concerns:

- Constructing an `evaluate` expression that escapes the intended `JsonSerializer.Serialize(...)` wrapper by exploiting an attacker-controlled `evaluateName`.
- Writing arbitrary content to the system clipboard from a non-user-initiated action.
- Persisting sensitive variable values to logs without the user's consent (the `trace` setting is off by default for this reason).

Out of scope:

- Function-evaluation side effects in the debuggee. Documented as a feature limitation; users opt in by clicking the menu item.
- Any vulnerability in the .NET debug adapter (`vsdbg`, `netcoredbg`).
