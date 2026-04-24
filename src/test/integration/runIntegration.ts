import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

// Pin to our engines.vscode floor so a passing CI run proves the
// minimum-supported promise still holds. Override with VSCODE_TEST_VERSION
// (e.g. "stable" or "insiders") for ad-hoc runs against newer builds.
const DEFAULT_VSCODE_VERSION = "1.89.0";

async function main(): Promise<void> {
  try {
    // Workspace root — two levels up from out/test/integration/.
    const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
    // Mocha runner module that adds and runs the *.test.js files.
    const extensionTestsPath = path.resolve(__dirname, "./index");

    await runTests({
      version: process.env.VSCODE_TEST_VERSION ?? DEFAULT_VSCODE_VERSION,
      extensionDevelopmentPath,
      extensionTestsPath,
      // Disable other installed extensions so the host is deterministic and
      // a stray third-party extension cannot break activation.
      launchArgs: ["--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exit(1);
  }
}

void main();
