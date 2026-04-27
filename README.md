# Copy as JSON (C# Debug)

[![CI](https://github.com/JadeEye21/vscode-csharp-copy-as-json/actions/workflows/ci.yml/badge.svg)](https://github.com/JadeEye21/vscode-csharp-copy-as-json/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code engine](https://img.shields.io/badge/vscode-%5E1.90.0-blue.svg)](https://code.visualstudio.com/updates/v1_90)

Right-click a variable in the VS Code **Variables** view during a C# / .NET debug session and copy it to the clipboard as pretty-printed JSON.

The extension drives the debug adapter through the standard [Debug Adapter Protocol `evaluate` request](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Evaluate) to invoke `System.Text.Json.JsonSerializer.Serialize` (or `Newtonsoft.Json.JsonConvert.SerializeObject` as a fallback) on the selected variable, then unescapes the resulting C# string literal and writes it to your system clipboard.

## Why

VS Code's built-in **Copy Value** copies the debugger's display string, which truncates collections, hides nested objects, and is not valid JSON. **Copy as JSON** gets you a real, indented JSON snapshot you can paste into a scratch file, a test fixture, an issue comment, or jq.

## Installation

Until the extension is on the Marketplace, install it from a VSIX:

1. Download the `.vsix` from the [latest GitHub Release](https://github.com/JadeEye21/vscode-csharp-copy-as-json/releases).
2. In VS Code: `View > Command Palette > Extensions: Install from VSIX...` and pick the file.

## Usage

1. Start a C# / .NET debug session (`debugType` `coreclr` or `clr`) and pause on a breakpoint.
2. Open the **Run and Debug** view, find your variable in the **Variables** panel.
3. Right-click the variable &rarr; **Copy as JSON**.
4. Paste anywhere.

Re-copying the same variable on the same paused frame is served from a frame-scoped in-memory cache &mdash; no DAP round-trip, no extra side effects. The cache is invalidated whenever you step, continue, switch frames in the **Call Stack** view, or end the session. Clicking the command again while a previous evaluate is still in flight cancels the previous and starts the new one (last click wins).

The first time you use the command on a fresh install, a one-time disclosure about side effects is appended to the **Copy as JSON** output channel (see [Limitations](#limitations)). Every subsequent invocation flashes a transient status-bar reminder that the command evaluates expressions in the debuggee process; you can mute that reminder via `csharpDebugCopyAsJson.showSideEffectReminder`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `csharpDebugCopyAsJson.allowedDebugTypes` | `["coreclr","clr"]` | Debug adapter types the runtime guard accepts. |
| `csharpDebugCopyAsJson.evaluateTimeoutMs` | `8000` | Per-attempt timeout for the DAP `evaluate` call. Increase for big object graphs. |
| `csharpDebugCopyAsJson.preferNewtonsoft` | `false` | Try `Newtonsoft.Json` before `System.Text.Json`. Useful when your project's serialization rules are Newtonsoft-flavored. |
| `csharpDebugCopyAsJson.trace` | `false` | Write expression / DAP / fallback / cache-hit diagnostics to the **Copy as JSON** output channel. Off by default to avoid persisting variable values to logs. |
| `csharpDebugCopyAsJson.showSideEffectReminder` | `true` | Show a transient status-bar reminder on every invocation that the command evaluates expressions in the debuggee process. Set to `false` once you are familiar with the behavior. The one-time output-channel disclosure is unaffected. |

## Limitations

- **Function evaluation is required.** Calling `Serialize(...)` invokes constructors and property getters in the debugged process. If your launch config or symbol options disable function evaluation (release builds without symbols, restrictive `justMyCode`), the command will return a "Could not serialize" error.
- **Side effects.** Property getters can mutate state, allocate, perform I/O, or throw. Treat **Copy as JSON** like running an arbitrary expression in the Debug Console.
- **`Newtonsoft.Json` fallback** requires the debugged process to actually reference Newtonsoft.Json at runtime. The extension cannot inject the assembly.
- **Synthesized debugger nodes** like `[Raw View]` and `Static members` cannot be evaluated by name and will produce a clear error.
- **Truncation.** The .NET adapter may still cap very long strings even with `clipboard` evaluate context. If you hit a limit, increase `csharpDebugCopyAsJson.evaluateTimeoutMs` and/or restructure the variable being serialized.
- **One session at a time.** If the active debug session changes between right-clicking and the command running, the extension aborts safely with a message.
- **Cancelled evaluates still run in the debuggee.** When you click the command twice in quick succession the second click cancels the first inside the extension, but the underlying DAP `evaluate` request cannot be aborted &mdash; the debugger still completes the cancelled call. Side effects from the cancelled invocation can still occur even though only one result reaches the clipboard.
- **Cache is best-effort within a paused frame.** The frame-scoped result cache assumes the variable's serialized form is stable while the frame is paused. Evaluating side-effecting expressions elsewhere (Debug Console, Watch view) between two **Copy as JSON** clicks on the same frame can return stale JSON from the cache.

## Troubleshooting

1. Toggle `csharpDebugCopyAsJson.trace` on, repeat the action, and open the **Copy as JSON** output channel (or click **View Logs** on the error toast).
2. Try the action against the bundled [`samples/dotnet-console`](samples/dotnet-console) project to rule out a project-specific issue.
3. File a bug at <https://github.com/JadeEye21/vscode-csharp-copy-as-json/issues> with the trace output and your `launch.json` (redact secrets).

## Development

```bash
git clone https://github.com/JadeEye21/vscode-csharp-copy-as-json.git
cd vscode-csharp-copy-as-json
npm install
npm run compile
npm test
```

Press `F5` in VS Code to launch the **Extension Development Host** with the bundled `samples/dotnet-console` workspace pre-opened. Build the sample (`Cmd+Shift+B` in the inner window) and start the `.NET Core Launch (SampleApp)` configuration to reproduce the UAT scenarios in [`docs/pbi-001-copy-as-json.md`](docs/pbi-001-copy-as-json.md).

## License

[MIT](LICENSE) &copy; 2026 Harshal Dhagale.
