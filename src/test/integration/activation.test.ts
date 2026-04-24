import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "JadeEye21.vscode-csharp-copy-as-json";
const COMMAND_ID = "csharpDebugCopyAsJson.copyAsJson";

suite("activation smoke", () => {
  test("extension is present and activates", async function () {
    this.timeout(30_000);

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(
      ext,
      `extension '${EXTENSION_ID}' is not installed in the test host`,
    );

    await ext.activate();
    assert.equal(ext.isActive, true, "extension did not activate cleanly");
  });

  test("copyAsJson command is registered", async function () {
    this.timeout(30_000);

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension '${EXTENSION_ID}' missing`);
    if (!ext.isActive) {
      await ext.activate();
    }

    const commands = await vscode.commands.getCommands(true);
    const ours = commands.filter((c) =>
      c.startsWith("csharpDebugCopyAsJson."),
    );
    assert.ok(
      ours.includes(COMMAND_ID),
      `expected '${COMMAND_ID}' to be registered; saw [${ours.join(", ") || "none"}]`,
    );
  });
});
