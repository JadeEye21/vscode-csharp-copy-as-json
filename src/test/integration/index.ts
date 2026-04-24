import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";

// Discover *.test.js files under out/test/integration/, recursing one level
// in case future tests are grouped into subfolders. We deliberately avoid the
// `glob` package: its transitive lru-cache@11 calls Node 19+ APIs
// (`diagnostics_channel.tracingChannel`) which crash inside the Electron
// renderer of older VS Code versions we still support (engines.vscode floor
// is 1.89, which bundles Node 18).
function findTestFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
        out.push(full);
      }
    }
  }
  return out;
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    // Activation can take a while on a cold test-electron download.
    timeout: 60_000,
  });

  const testsRoot = path.resolve(__dirname);
  for (const file of findTestFiles(testsRoot)) {
    mocha.addFile(file);
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}
