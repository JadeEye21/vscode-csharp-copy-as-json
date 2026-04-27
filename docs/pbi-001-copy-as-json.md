# PBI-001: Copy variable as JSON during C# debugging

## Status

**Completed in v0.0.1.**

## Goal

Allow a developer to right-click any variable in the VS Code Variables view during a paused .NET debug session and copy a pretty-printed JSON snapshot of that variable to the clipboard.

## Scope

In:

- `debug/variables/context` menu contribution titled **Copy as JSON**.
- DAP `evaluate` of `System.Text.Json.JsonSerializer.Serialize(...)` with a `Newtonsoft.Json.JsonConvert.SerializeObject(...)` fallback.
- Capability-aware evaluate-context order (`clipboard` &rarr; `hover` &rarr; `repl`).
- C# string-literal unescape before clipboard write.
- Per-attempt timeout (default 8 s, configurable).
- Concurrency guard against double-invocation.
- Diagnostics output channel gated by a `trace` setting.
- One-time side-effect warning toast.

Out:

- Watch view / Call Stack view context menus.
- Marketplace publish.
- Streaming retrieval of very large objects via `variablesReference` traversal.

## Architectural decisions

| Decision | Reasoning |
|---|---|
| Use `customRequest('evaluate', ...)` instead of an `activeDebugSession.evaluate` method | The latter is not on the public `vscode.d.ts` API surface; only `customRequest` is. |
| Engine `^1.89.0` | `vscode.debug.activeStackItem` (the public way to get a `frameId` from outside the active editor) was added in 1.89. |
| `(object)` cast in the C# expression | Avoids an STJ source-generated overload trap on value types in some `coreclr` versions. |
| Capability check `supportsClipboardContext` before choosing `clipboard` first | Mirrors VS Code's own built-in "Copy Value" behavior. |
| Pure utilities live under `src/util/` and are unit-tested | Keeps the only `vscode`-importing file (`extension.ts`) thin. |
| Hand-rolled unescape fallback when `JSON.parse` rejects | C#-only escapes (`\xNN`, `\a`, `\v`) are not legal JSON. |

## Acceptance criteria

- Right-clicking a variable in **Run and Debug &rarr; Variables** while paused in a `coreclr` (or `clr`) session shows **Copy as JSON**.
- Clicking it copies real, indented JSON to the clipboard within the configured timeout.
- For variables where `evaluateName` is missing and no parent expression is available, the menu still appears but on click the user gets a clear non-blocking message.
- For non-`coreclr`/`clr` sessions, or while not stopped, the menu item does not appear.
- Both `Serialize` paths failing produces a `Could not serialize: <reason>` error toast with a **View Logs** button that focuses the **Copy as JSON** output channel.
- Tag `v0.0.1` triggers a GitHub Release with the `.vsix` attached.

## UAT checklist

Open `samples/dotnet-console`, run `dotnet restore` once, then start the **`.NET Core Launch (SampleApp)`** configuration. Set a breakpoint on the final `Console.WriteLine` in `Program.cs`. For each row below, right-click the named variable in the Variables view and choose **Copy as JSON**, then paste into a scratch buffer.

| # | Variable / scenario | Expected result |
|---|---|---|
| 1 | `person` | Indented JSON with `Name`, `Age`, and a nested `Friends` array (`Grace`, `Linus`). |
| 2 | `counts` | `{"apples": 3, "bananas": 7}` indented. |
| 3 | `now` | A single ISO-8601 string in JSON. |
| 4 | `trap.Slow` | Times out after 8 s with a clean error toast (no UI hang). |
| 5 | First-use warning | Information message about side effects appears once per profile, then never again after dismiss. |
| 6 | Disable Newtonsoft (`<PackageReference Include="Newtonsoft.Json" ...>` removed): `person` with `csharpDebugCopyAsJson.preferNewtonsoft: true` | First attempt fails (Newtonsoft missing), second attempt succeeds via System.Text.Json, clipboard contains real JSON. |
| 7 | Wrong session: launch a second `coreclr` session and switch focus before triggering | Error toast: "Active debug session changed; please re-trigger Copy as JSON." |
| 8 | Non-C#: Node.js debug session, right-click a JS variable | Menu item does not appear. |
| 9 | `[Raw View]` / `Static members` synthetic node | Error toast naming the synthetic node. |
| 10 | Trace setting on, repeat scenario 1 | Output channel **Copy as JSON** logs target, frameId, contexts tried, success line. |

## Telemetry

None. The extension does not send any data anywhere.

## Open follow-ups (not blocking)

- Add an icon (128x128 PNG).
- Add the same command to `debug/watch/context`.
- Optional chunked retrieval for very large objects via `variablesReference` traversal.
