import * as cp from "node:child_process";
import * as path from "node:path";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";

// Pin to our engines.vscode floor so a passing CI run proves the
// minimum-supported promise still holds. Override with VSCODE_TEST_VERSION
// (e.g. "stable" or "insiders") for ad-hoc runs against newer builds.
//
// 1.90.0 is the floor because PBI-011 / C2 subscribes to
// `vscode.debug.onDidChangeActiveStackItem` at activation time, and that API
// (along with `vscode.debug.activeStackItem`, used since PBI-004) graduated
// from the `debugFocus` proposal to stable in VS Code 1.90.0
// (microsoft/vscode#212190, May 2024 milestone). On 1.89.x the activation
// throws because the host blocks unapproved use of proposed APIs.
const DEFAULT_VSCODE_VERSION = "1.90.0";

// E2E mode: honor RUN_E2E=1 to exercise the real coreclr debugger against
// the test-fixtures/csharp-sample project. This requires a different VS Code
// host (the floor may pre-date the current ms-dotnettools.csharp engine
// requirement) and a different launch profile (workspace folder open, the C#
// extension installed into the test profile). Default to "stable" but still
// honor an explicit VSCODE_TEST_VERSION override.
const E2E_DEFAULT_VSCODE_VERSION = "stable";
const CSHARP_EXTENSION_ID = "ms-dotnettools.csharp";

async function main(): Promise<void> {
  try {
    // Workspace root — two levels up from out/test/integration/.
    const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
    // Mocha runner module that adds and runs the *.test.js files.
    const extensionTestsPath = path.resolve(__dirname, "./index");

    if (process.env.RUN_E2E === "1") {
      await runE2e(extensionDevelopmentPath, extensionTestsPath);
    } else {
      await runUnitAndSmoke(extensionDevelopmentPath, extensionTestsPath);
    }
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exit(1);
  }
}

async function runUnitAndSmoke(
  extensionDevelopmentPath: string,
  extensionTestsPath: string,
): Promise<void> {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? DEFAULT_VSCODE_VERSION,
    extensionDevelopmentPath,
    extensionTestsPath,
    // Disable other installed extensions so the host is deterministic and
    // a stray third-party extension cannot break activation.
    launchArgs: ["--disable-extensions"],
  });
}

async function runE2e(
  extensionDevelopmentPath: string,
  extensionTestsPath: string,
): Promise<void> {
  const fixtureDir = path.resolve(
    extensionDevelopmentPath,
    "test-fixtures/csharp-sample",
  );
  const version = process.env.VSCODE_TEST_VERSION ?? E2E_DEFAULT_VSCODE_VERSION;

  // Reap stragglers from any previously-interrupted run before we spin up a
  // fresh test host. Without this, a leftover `csharp-sample.dll` debuggee or
  // an extension-host Roslyn server can hold ports/files and make the next
  // run hang on debugger startup. We MUST be surgical about the predicate
  // (only processes whose argv mentions our `.vscode-test` profile or our
  // fixture binary) so we never touch the user's real VS Code instance.
  reapStaleE2eProcesses();

  // Build the fixture before launching VS Code so the configured `program`
  // path exists when the e2e test calls `vscode.debug.startDebugging`. We do
  // this here (rather than via a `preLaunchTask` in launch.json) so a build
  // failure surfaces with the build output directly, before the test even
  // starts.
  console.log(`[e2e] dotnet build (${fixtureDir})`);
  const build = cp.spawnSync("dotnet", ["build", "-c", "Debug", "--nologo"], {
    cwd: fixtureDir,
    encoding: "utf-8",
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new Error(
      "failed to build the C# fixture; ensure the .NET SDK is installed and on PATH",
    );
  }

  // Download VS Code (cached under .vscode-test/ via test-electron) and
  // install ms-dotnettools.csharp into the test profile so the `coreclr`
  // debug type is registered. We do this through the VS Code CLI, not by
  // bundling the extension; the C# extension's Marketplace EULA permits
  // installation for personal use but not redistribution.
  console.log(`[e2e] downloading VS Code (${version})`);
  const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(
    vscodeExecutablePath,
  );
  console.log(`[e2e] installing ${CSHARP_EXTENSION_ID} into test profile`);
  const install = cp.spawnSync(
    cli,
    [
      ...cliArgs,
      "--install-extension",
      CSHARP_EXTENSION_ID,
      "--force",
    ],
    { encoding: "utf-8", stdio: "inherit" },
  );
  if (install.status !== 0) {
    throw new Error(
      `failed to install ${CSHARP_EXTENSION_ID} into the test host (network / Marketplace?)`,
    );
  }

  console.log(`[e2e] launching test host with workspace ${fixtureDir}`);
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    // Open the fixture folder so vscode.workspace.workspaceFolders[0] is the
    // .NET project root (vscode.debug.startDebugging needs a folder context).
    // We deliberately do NOT pass --disable-extensions: the C# extension we
    // just installed is the whole point of e2e mode.
    launchArgs: [fixtureDir],
    extensionTestsEnv: {
      RUN_E2E: "1",
      // Tells extension.ts to pre-seed the "side-effect warning shown" flag
      // in globalState so the modal does not appear during automation. The
      // .vscode-test/ profile is fresh on first use (and on any
      // `rm -rf .vscode-test`); without this, the warning toast appears,
      // resolves with `undefined` after auto-dismiss, and the flag never
      // gets persisted -- so it would fire on every single run forever.
      CSHARP_COPY_AS_JSON_E2E: "1",
    },
  });
}

/**
 * Best-effort cleanup of orphan processes from a previously-interrupted e2e
 * run. We use two narrow `pkill -9 -f` predicates:
 *
 *   1. `/.vscode-test/`  -> matches the test-profile VS Code (downloaded into
 *      `<repo>/.vscode-test/`) and any extension-host child it launched
 *      (Roslyn LS, BuildHost, etc.). The user's real VS Code lives in
 *      `/Applications/Visual Studio Code.app/...`, so this string cannot
 *      match it.
 *
 *   2. `csharp-sample.dll` -> matches the fixture debuggee that survived a
 *      hung `stopDebugging` call.
 *
 * pkill returns 1 when nothing matched; we treat that as success. Any other
 * non-zero exit is logged but does NOT abort the run -- the worst case is
 * that the next launch fails with a clearer error than a silent hang.
 */
function reapStaleE2eProcesses(): void {
  const predicates = ["/.vscode-test/", "csharp-sample.dll"];
  for (const predicate of predicates) {
    const result = cp.spawnSync("pkill", ["-9", "-f", predicate], {
      encoding: "utf-8",
    });
    // pkill exit codes: 0 = killed something, 1 = no match, 2/3 = error.
    if (result.status === 0) {
      console.log(`[e2e] reaped stale processes matching '${predicate}'`);
    } else if (result.status !== 1) {
      console.warn(
        `[e2e] pkill -f '${predicate}' returned ${result.status}: ${result.stderr ?? ""}`,
      );
    }
  }
}

void main();
