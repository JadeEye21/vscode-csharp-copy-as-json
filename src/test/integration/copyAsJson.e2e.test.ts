import { strict as assert } from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const RUN_E2E = process.env.RUN_E2E === "1";

const EXTENSION_ID = "JadeEye21.vscode-csharp-copy-as-json";
const CSHARP_EXTENSION_ID = "ms-dotnettools.csharp";
const COMMAND_ID = "csharpDebugCopyAsJson.copyAsJson";
const TRACE_SETTING = "csharpDebugCopyAsJson.trace";

// Marker the test scans for in Program.cs. The breakpoint lands on the line
// IMMEDIATELY AFTER this marker comment.
const BREAKPOINT_MARKER = "BREAK_HERE_LINE";

// When the test host opens the fixture via launchArgs, the workspace root is
// the fixture folder. All paths below are relative to that root.
const PROGRAM_CS_RELATIVE = "Program.cs";
const PROGRAM_DLL_RELATIVE = "bin/Debug/net9.0/csharp-sample.dll";
// Where we dump the clipboard payload after the command runs. Lives inside
// the fixture (gitignored) so a developer can `cat test.json | jq .` after a
// run to eyeball what the command actually produced. The file is also the
// source of truth for our assertions: we read clipboard once with a short
// timeout, write it here, then assert against the file content. This
// decouples the assertion from `vscode.env.clipboard` (which other extensions
// or system clipboard managers can race on) and gives us a tangible UAT
// artifact.
const CLIPBOARD_DUMP_RELATIVE = "test.json";
// Where extension.ts (running under CSHARP_COPY_AS_JSON_E2E=1) mirrors every
// trace() and showError() call. Reading another extension's OutputChannel from
// a test is not a public API in any current VS Code version (the
// `workbench.action.output.show.<channel>` command name has changed across
// 1.89, 1.117, etc.), so we use a file the extension produces itself.
const TRACE_LOG_RELATIVE = "test.trace.log";

// How long to wait for the clipboard to be populated after invoking the
// command. Kept short (5s) on purpose: if the command silently fails, we want
// the test to abort fast so the trace output channel (which we ALWAYS print
// on failure below) tells us why, instead of the test eating its full 120s
// timeout and the user seeing a bare "timeout" with no signal.
const CLIPBOARD_WAIT_MS = 5_000;
// How long suiteTeardown is willing to wait for stopDebugging. The C# adapter
// can hang here if the debuggee is in a wedged state; bound it so the next
// run is not blocked by a previous teardown. In the happy path this is a
// no-op because the test resumes the debugger and waits for it to exit.
const STOP_DEBUGGING_TIMEOUT_MS = 10_000;
// How long the test waits for the debuggee to exit cleanly after we issue
// `continue`. The fixture is a single Console.WriteLine; sub-second is normal.
// The generous timeout exists only for first-run JIT / adapter overhead.
const TERMINATE_WAIT_MS = 15_000;

suite("e2e copy-as-json against real coreclr debugger", function () {
  // Mocha pattern: when RUN_E2E is unset, register a single placeholder test
  // that calls this.skip(). This avoids running suiteSetup (which would fail
  // because ms-dotnettools.csharp is not installed in the unit/smoke profile)
  // and keeps the default `npm test` clean.
  if (!RUN_E2E) {
    test("skipped (set RUN_E2E=1 to run)", function () {
      this.skip();
    });
    return;
  }

  // Real-debugger e2e is slow: VS Code download is cached but adapter
  // first-run downloads ~50MB of debugger binaries, dotnet build is ~5s,
  // and breakpoint sync adds variable latency. 120s per test is generous
  // but matches what the C# extension itself uses in its own tests.
  this.timeout(120_000);

  let workspaceFolder: vscode.WorkspaceFolder;
  let programCsAbs: string;
  let programDllAbs: string;
  let clipboardDumpAbs: string;
  let traceLogAbs: string;

  suiteSetup(async function () {
    const ours = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ours, `${EXTENSION_ID} not installed in test host`);
    await ours.activate();

    const csharp = vscode.extensions.getExtension(CSHARP_EXTENSION_ID);
    assert.ok(
      csharp,
      `${CSHARP_EXTENSION_ID} is required for e2e but not installed in this host. ` +
        "Did runIntegration.ts skip its install step?",
    );
    await csharp.activate();

    const folders = vscode.workspace.workspaceFolders;
    assert.ok(
      folders && folders.length > 0,
      "no workspace folder open; did runIntegration.ts forget to pass the fixture path in launchArgs?",
    );
    workspaceFolder = folders[0];
    programCsAbs = path.join(workspaceFolder.uri.fsPath, PROGRAM_CS_RELATIVE);
    programDllAbs = path.join(workspaceFolder.uri.fsPath, PROGRAM_DLL_RELATIVE);
    clipboardDumpAbs = path.join(
      workspaceFolder.uri.fsPath,
      CLIPBOARD_DUMP_RELATIVE,
    );
    traceLogAbs = path.join(workspaceFolder.uri.fsPath, TRACE_LOG_RELATIVE);

    // Best-effort: remove any leftover artifacts from a previous run so a
    // stale file cannot make a failing test appear to pass (or a stale log
    // mislead the diagnosis when this run produces no output).
    await fs.rm(clipboardDumpAbs, { force: true });
    // NOTE: do NOT delete traceLogAbs here -- extension.ts truncates it on
    // activation. Deleting it would race with the activate() write.

    // Sanity: the build artifact must already exist (runIntegration.ts ran
    // `dotnet build` before launching the host). If this fails, the build
    // step silently produced output in a different folder.
    await fs.access(programDllAbs).catch(() => {
      throw new Error(
        `expected build output at ${programDllAbs}; did runIntegration.ts build the fixture?`,
      );
    });

    // Force trace ON for the workspace so the PBI-003 promotion assertion can
    // read context order from the output channel. Workspace-scope so we don't
    // leak into the user's global settings if the test is run locally.
    await vscode.workspace
      .getConfiguration()
      .update(TRACE_SETTING, true, vscode.ConfigurationTarget.Workspace);
  });

  suiteTeardown(async function () {
    // Best-effort cleanup. Failures here would mask the real test result, and
    // a hang here would block the next run from starting (this is what bit us
    // during PBI-010 development -- the C# adapter can take >60s to honor a
    // disconnect when its debuggee is in a wedged state). We bound every step.
    try {
      const session = vscode.debug.activeDebugSession;
      if (session) {
        // Promise.race against a timer: if the adapter never acks our
        // disconnect, we proceed anyway and let runIntegration.ts's pkill
        // sweep catch the orphan on the next launch.
        await Promise.race([
          vscode.debug.stopDebugging(session),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              console.warn(
                `[e2e] stopDebugging did not return within ${STOP_DEBUGGING_TIMEOUT_MS}ms; ` +
                  "leaving the session for the next run's pkill sweep",
              );
              resolve();
            }, STOP_DEBUGGING_TIMEOUT_MS),
          ),
        ]);
      }
      vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
      await vscode.workspace
        .getConfiguration()
        .update(TRACE_SETTING, undefined, vscode.ConfigurationTarget.Workspace);
    } catch (err) {
      console.warn("[e2e] suiteTeardown warning:", err);
    }
  });

  // The test runs in three phases. This separation is deliberate (per UAT
  // feedback during PBI-010 development): assertions never share a tick with
  // a paused debugger or a still-shutting-down adapter, which removes the
  // last category of races from this suite.
  //
  //   PHASE 1 (ACT, debugger paused)
  //     Set breakpoint, launch coreclr, wait for the stop-on-breakpoint,
  //     locate the `person` local, invoke our command, read clipboard,
  //     persist payload to test.json on disk. Capture the trace channel
  //     BEFORE we resume so we can later assert PBI-003 ordering.
  //
  //   PHASE 2 (RESUME + WAIT FOR TERMINATE)
  //     Subscribe to onDidTerminateDebugSession FIRST, then issue continue.
  //     The fixture's Main() body after the breakpoint is a single
  //     Console.WriteLine, so the process exits within a few hundred ms.
  //     Bound with TERMINATE_WAIT_MS just in case JIT/adapter shutdown
  //     stalls; if it does, we abort with a clear message and let
  //     suiteTeardown's bounded stopDebugging do the cleanup.
  //
  //   PHASE 3 (ASSERT, debugger gone)
  //     Re-read test.json from disk (NOT from the in-memory string we wrote)
  //     so the assertion reflects exactly what a developer running
  //     `cat test.json` would see. Parse, assert field by field. If any
  //     assertion fails, test.json is still on disk for inspection.
  test("copies a complex Person object as JSON", async function () {
    // -----------------------------------------------------------------
    // PHASE 1 -- ACT
    // -----------------------------------------------------------------
    const breakpointLine = await findBreakpointLine(programCsAbs);
    const bp = new vscode.SourceBreakpoint(
      new vscode.Location(
        vscode.Uri.file(programCsAbs),
        new vscode.Position(breakpointLine, 0),
      ),
      true,
    );
    vscode.debug.addBreakpoints([bp]);

    const started = await vscode.debug.startDebugging(workspaceFolder, {
      name: "e2e-copy-as-json",
      type: "coreclr",
      request: "launch",
      program: programDllAbs,
      args: [],
      cwd: workspaceFolder.uri.fsPath,
      console: "internalConsole",
      stopAtEntry: false,
      justMyCode: true,
    });
    assert.ok(started, "vscode.debug.startDebugging returned false");

    const frame = await waitForStackFrame(60_000);
    const session = vscode.debug.activeDebugSession;
    assert.ok(session, "no active debug session after stack frame appeared");
    assert.equal(session.type, "coreclr");

    const personArg = await buildVariablesContextForLocal(
      session,
      frame.frameId,
      "person",
    );

    // Seed clipboard with a non-JSON sentinel so we can distinguish
    // "command never wrote" from "command wrote something we can assert on".
    const SENTINEL = "<sentinel: command did not write>";
    await vscode.env.clipboard.writeText(SENTINEL);

    await vscode.commands.executeCommand(COMMAND_ID, personArg);

    const clipboardText = await waitForClipboardChange(
      SENTINEL,
      CLIPBOARD_WAIT_MS,
    );
    if (clipboardText === SENTINEL) {
      // The command did not call clipboard.writeText. Almost certainly it hit
      // showError() instead. Read the file-backed trace log -- which captures
      // every trace() and showError() line from extension.ts -- so the
      // failure message contains the actual evaluator error (STJ exception,
      // missing Newtonsoft assembly, etc.) instead of an opaque timeout.
      const traceText = await readTraceLog(traceLogAbs);
      assert.fail(
        `command did not write to the clipboard within ${CLIPBOARD_WAIT_MS}ms; ` +
          `it most likely failed silently. Trace log (${traceLogAbs}):\n${traceText}`,
      );
    }

    // Persist BEFORE resuming so test.json is available on disk even if the
    // resume / terminate phase blows up below. Write the raw clipboard text
    // verbatim -- no re-serialization -- so the artifact matches exactly what
    // an end user would paste from the clipboard.
    await fs.writeFile(clipboardDumpAbs, clipboardText, "utf8");
    console.log(`[e2e] wrote clipboard payload to ${clipboardDumpAbs}`);

    // -----------------------------------------------------------------
    // PBI-011 / C1 + C2: second click on the same paused frame MUST be
    // served from the frame-scoped result cache, not by issuing a second
    // DAP evaluate. This is the regression test for the user-reported
    // "Copy as JSON is already running for the previous variable" lock-up:
    // after a successful copy, copying unrelated text (here we overwrite
    // the clipboard with a fresh sentinel) and re-invoking the command on
    // the same variable must restore the JSON instantly with no toast and
    // no second adapter round-trip.
    // -----------------------------------------------------------------
    const SECOND_SENTINEL = "<sentinel: second click did not write>";
    await vscode.env.clipboard.writeText(SECOND_SENTINEL);

    await vscode.commands.executeCommand(COMMAND_ID, personArg);

    const secondClipboardText = await waitForClipboardChange(
      SECOND_SENTINEL,
      CLIPBOARD_WAIT_MS,
    );
    if (secondClipboardText === SECOND_SENTINEL) {
      const failTrace = await readTraceLog(traceLogAbs);
      assert.fail(
        `second click did not write to the clipboard within ${CLIPBOARD_WAIT_MS}ms; ` +
          `the PBI-011 cache-hit path is broken (or the second invocation was ` +
          `silently refused). Trace log (${traceLogAbs}):\n${failTrace}`,
      );
    }
    assert.equal(
      secondClipboardText,
      clipboardText,
      "second click on the same paused variable should write byte-for-byte " +
        "the same JSON as the first click (served from the result cache)",
    );

    // Capture the trace log NOW, while it's small and easy to attribute to
    // this command invocation. Reading after termination would still work
    // (the file persists), but capturing here keeps the assertion below
    // attached to a single, unambiguous slice of the log -- BOTH the first
    // (real evaluate) and the second (cache hit) clicks above.
    const traceText = await readTraceLog(traceLogAbs);

    // -----------------------------------------------------------------
    // PHASE 2 -- RESUME + WAIT FOR TERMINATE
    // -----------------------------------------------------------------
    // Subscribe BEFORE issuing continue: an instantly-exiting debuggee could
    // otherwise emit Terminated before our listener attaches, and we'd hang
    // here for the full TERMINATE_WAIT_MS for an event that already fired.
    const sessionId = session.id;
    const terminated = new Promise<void>((resolve) => {
      const sub = vscode.debug.onDidTerminateDebugSession((s) => {
        if (s.id === sessionId) {
          sub.dispose();
          resolve();
        }
      });
    });

    // `workbench.action.debug.continue` is the same command the F5/Continue
    // toolbar button dispatches. Preferred over a raw `customRequest('continue',
    // { threadId })` because it routes through the same single source of truth
    // VS Code uses for multi-thread bookkeeping; a manual `continue` against
    // one thread can leave another suspended.
    await vscode.commands.executeCommand("workbench.action.debug.continue");

    const terminatedInTime = await Promise.race([
      terminated.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), TERMINATE_WAIT_MS),
      ),
    ]);
    assert.ok(
      terminatedInTime,
      `debuggee did not terminate within ${TERMINATE_WAIT_MS}ms after resume; ` +
        "the fixture's Main() should exit immediately after the Console.WriteLine. " +
        "If you see this, the adapter is wedged -- check the C# Output channel.",
    );

    // -----------------------------------------------------------------
    // PHASE 3 -- ASSERT (debugger gone)
    // -----------------------------------------------------------------
    // Re-read from disk on purpose: assert against what a developer would see
    // by running `cat test.json`, not against the in-memory copy we just
    // wrote. If these ever diverge (e.g. file system encoding bug) we want to
    // know.
    const onDiskText = await fs.readFile(clipboardDumpAbs, "utf8");

    // Round-trip integrity: the bytes a user pastes (clipboardText) MUST
    // equal the bytes a developer inspects via `cat test.json`. If these
    // ever diverge we either have an encoding bug in writeFile or we are
    // testing a different artifact than the user sees.
    assert.equal(
      onDiskText,
      clipboardText,
      "on-disk test.json bytes diverged from in-memory clipboard text",
    );

    // Pretty-printed structural sanity on the RAW payload (before parse):
    //   - WriteIndented=true: must contain newlines and 2-space indented keys
    //   - decimal precision: must contain the literal "12345.67" (NOT
    //     12345.6699999... -- catches IEEE-754 drift that JSON.parse->Number
    //     would silently round back to 12345.67)
    //   - no double-escaping: must NOT contain "\\u0022" or "\\\\n", which
    //     would mean we accidentally re-escaped the unescaped C# string
    assert.match(
      onDiskText,
      /\n {2}"Id":/,
      "raw payload should be pretty-printed (WriteIndented=true) with 2-space indent",
    );
    assert.match(
      onDiskText,
      /"Salary": 12345\.67(\D|$)/,
      "raw payload must preserve exact decimal precision; JS Number would silently round drift",
    );
    assert.ok(
      !/\\\\u00/.test(onDiskText) && !/\\\\n/.test(onDiskText),
      `raw payload contains double-escaped sequences (\\\\uXXXX or \\\\n); ` +
        `the unescape pipeline regressed. Payload:\n${onDiskText}`,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(onDiskText);
    } catch (err) {
      assert.fail(
        `${clipboardDumpAbs} did not parse as JSON: ${(err as Error).message}\n` +
          `--- file content ---\n${onDiskText}`,
      );
    }

    assert.equal(typeof parsed, "object");
    assert.ok(parsed !== null, "parsed payload must not be null");
    const obj = parsed as Record<string, unknown>;

    // Exact top-level shape: catches if Person ever gains/loses a field
    // unexpectedly (e.g. STJ JsonIgnore, source-generator misconfig). We
    // sort both sides so insertion order doesn't matter.
    assert.deepEqual(
      Object.keys(obj).sort(),
      [
        "Age",
        "BirthDate",
        "Description",
        "Hobbies",
        "HomeAddress",
        "Id",
        "IsActive",
        "LuckyNumbers",
        "Manager",
        "Name",
        "Salary",
        "Scores",
        "Tier",
        "WorkAddress",
      ],
      "top-level Person shape changed; update fixture or extension",
    );

    // STJ writes Guid as a lowercase hex-with-dashes string. We assert the
    // exact value we constructed, case-insensitive to be safe across runtimes.
    assert.equal(typeof obj.Id, "string", "Guid must serialize as string");
    assert.equal(
      String(obj.Id).toLowerCase(),
      "12345678-1234-1234-1234-123456789012",
    );

    assert.equal(typeof obj.Name, "string");
    assert.equal(obj.Name, 'Ada "Lovelace"', "name with embedded quote");

    assert.equal(typeof obj.Age, "number");
    assert.equal(obj.Age, 36);

    assert.equal(typeof obj.IsActive, "boolean");
    assert.equal(obj.IsActive, true);

    // STJ writes decimal as a JSON number (12345.67), NOT a string. The
    // typeof check is the regression guard: if STJ ever switches its
    // default decimal serialization to string we want to fail loudly.
    assert.equal(typeof obj.Salary, "number", "decimal must serialize as JSON number");
    assert.equal(obj.Salary, 12345.67);

    // STJ writes DateTime with Kind=Utc as ISO 8601 with a trailing 'Z'.
    // We constructed 1815-12-10T00:00:00Z. Match by regex so we don't fail
    // on micro-precision differences across runtime versions ("...Z" vs
    // "...0000000Z").
    assert.equal(typeof obj.BirthDate, "string");
    assert.match(
      String(obj.BirthDate),
      /^1815-12-10T00:00:00(?:\.0+)?Z$/,
      `expected ISO-8601 UTC for BirthDate; got ${String(obj.BirthDate)}`,
    );

    // STJ default for enums is the underlying integer value, NOT the name.
    // AccountType.Premium = 1. (Users who want names configure their own
    // JsonStringEnumConverter; out of scope for this fixture.)
    assert.equal(typeof obj.Tier, "number", "enum must serialize as int by default");
    assert.equal(obj.Tier, 1, "AccountType.Premium should serialize as 1");

    const home = obj.HomeAddress as Record<string, unknown> | undefined;
    assert.ok(home, "HomeAddress missing");
    assert.deepEqual(
      home,
      { Street: "10 Downing St", City: "London", CountryCode: "GB" },
      "HomeAddress shape changed",
    );

    // Nullable reference written as JSON null (not omitted, not "").
    // strictEqual catches `undefined` (which would mean key was omitted).
    assert.strictEqual(obj.WorkAddress, null);
    assert.strictEqual(obj.Manager, null);

    assert.ok(Array.isArray(obj.Hobbies));
    assert.deepEqual(obj.Hobbies, ["math", "writing", "tea-time"]);

    assert.ok(Array.isArray(obj.LuckyNumbers));
    assert.deepEqual(obj.LuckyNumbers, [7, 13, 42]);

    const scores = obj.Scores as Record<string, unknown> | undefined;
    assert.ok(scores && !Array.isArray(scores), "Scores must be a JSON object");
    assert.deepEqual(
      scores,
      { analytical: 99, narrative: 87 },
      "Scores shape changed",
    );

    // Exact equality (not regex): proves the unescape pipeline produces
    // EXACTLY the C# source string -- unicode escapes decoded to real
    // codepoints, embedded \n decoded to a real newline, no extra chars.
    assert.equal(
      obj.Description,
      "First programmer; loves \u2728 unicode \u2728\nand newlines.",
      "description must round-trip unicode and embedded newline byte-for-byte",
    );

    // -----------------------------------------------------------------
    // Trace log assertions: prove STJ (clipboard) won on the FIRST try
    // with no silent fallback. If the extension ever regresses such that
    // clipboard fails and we silently fall back to hover/repl/Newtonsoft,
    // these negative assertions catch it -- the user-visible JSON might
    // still look right, but the chosen path is wrong.
    // -----------------------------------------------------------------

    // PBI-003 promotion: clipboard-first ordering against the real adapter.
    assert.match(
      traceText,
      /evaluate contexts = clipboard, hover, repl/,
      `expected clipboard-first ordering; got:\n${traceText}`,
    );

    // Positive: STJ-clipboard attempt happened.
    assert.match(
      traceText,
      /evaluate \(System\.Text\.Json \(clipboard\)\):/,
      `expected STJ clipboard attempt in trace; got:\n${traceText}`,
    );

    // Negative: no validation-failed line, no fallback to hover/repl/Newtonsoft,
    // no [ERROR]. If any of these appear, STJ-clipboard did NOT win on first
    // try and the fact that the JSON looks right is masking the regression.
    assert.ok(
      !/validation failed:/.test(traceText),
      `trace contains 'validation failed' -- STJ-clipboard did not win on first try:\n${traceText}`,
    );
    assert.ok(
      !/evaluate \(System\.Text\.Json \(hover\)\):/.test(traceText) &&
        !/evaluate \(System\.Text\.Json \(repl\)\):/.test(traceText),
      `trace shows STJ fallback to hover/repl context -- clipboard failed silently:\n${traceText}`,
    );
    assert.ok(
      !/evaluate \(Newtonsoft\.Json/.test(traceText),
      `trace shows Newtonsoft fallback -- STJ failed silently:\n${traceText}`,
    );
    assert.ok(
      !/^\[ERROR\]/m.test(traceText),
      `trace contains [ERROR] line -- command surfaced an error to the user:\n${traceText}`,
    );

    // -----------------------------------------------------------------
    // PBI-011 cache-hit assertions on the SAME captured trace slice.
    // The first click logged `evaluate (...)`; the second click MUST log
    // `cache hit:` and MUST NOT log a second `evaluate (...)`.
    // -----------------------------------------------------------------

    assert.match(
      traceText,
      /cache hit: person /,
      `expected a 'cache hit: person ...' line from the second click; ` +
        `the cache-hit path did not fire. Trace:\n${traceText}`,
    );

    // Exactly ONE `evaluate (` line across both clicks. If we see two, the
    // cache miss path ran on the second click -- meaning the lookup failed
    // (key derivation regression) or invalidation fired prematurely.
    const evaluateLineCount = (
      traceText.match(/^\[[^\]]+\] evaluate \(/gm) ?? []
    ).length;
    assert.equal(
      evaluateLineCount,
      1,
      `expected exactly 1 'evaluate (' line across both clicks (first hits ` +
        `the adapter, second is a cache hit); got ${evaluateLineCount}. ` +
        `Full trace:\n${traceText}`,
    );

    // The 'cancelled' code paths should NOT fire on a clean two-click flow
    // where the first click fully resolved before the second started. If
    // we see this line the cancel-and-replace dispatch is firing when it
    // shouldn't (e.g. the previous CTS was not cleared in the finally).
    assert.ok(
      !/^\[[^\]]+\] cancelled/m.test(traceText),
      `trace contains a 'cancelled' line -- the second click was treated as ` +
        `a cancel-replace of the first, not as a fresh invocation. Trace:\n${traceText}`,
    );
  });
});

async function findBreakpointLine(filePath: string): Promise<number> {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  // Match lines whose trimmed content STARTS with the marker comment, e.g.
  // `        // BREAK_HERE_LINE - ...`. We deliberately do NOT match
  // arbitrary occurrences of the literal token (e.g. doc comments that
  // mention the marker name like `// Do NOT change "BREAK_HERE_LINE"...`),
  // because findIndex returns the first hit and the debugger then resolves
  // the breakpoint to the nearest IL on a comment line - which lands inside
  // a record's synthesized constructor instead of Main. Subtle, learned
  // the hard way. Keep this strict.
  const markerPrefix = `// ${BREAKPOINT_MARKER}`;
  const markerIdx = lines.findIndex((l) => l.trim().startsWith(markerPrefix));
  if (markerIdx < 0) {
    throw new Error(
      `breakpoint marker comment '${markerPrefix}' not found in ${filePath}`,
    );
  }
  // Breakpoint lands on the line IMMEDIATELY AFTER the marker comment.
  // vscode.Position is 0-based; the marker is at line index markerIdx, so
  // the executable line is markerIdx + 1.
  return markerIdx + 1;
}

async function waitForStackFrame(
  timeoutMs: number,
): Promise<vscode.DebugStackFrame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = vscode.debug.activeStackItem;
    if (item instanceof vscode.DebugStackFrame) {
      return item;
    }
    await delay(100);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for vscode.debug.activeStackItem to be a DebugStackFrame`,
  );
}

/**
 * Poll the clipboard until it differs from `seedValue`, or return `seedValue`
 * unchanged after `timeoutMs`. Caller decides what an unchanged value means
 * (we use it to distinguish "command never wrote" from "command wrote
 * something we can assert on"). Returning instead of throwing lets the caller
 * attach the trace channel contents to the failure message, which is the
 * difference between "timeout" (useless) and a real diagnosis.
 */
async function waitForClipboardChange(
  seedValue: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await vscode.env.clipboard.readText();
    if (text !== seedValue) {
      return text;
    }
    await delay(100);
  }
  return seedValue;
}

interface DapScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
}

interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
  evaluateName?: string;
}

/**
 * Mirror what VS Code does internally before invoking a command contributed
 * under `debug/variables/context`: walk the focused frame's scopes, find the
 * Locals scope, locate the variable by name, and bundle it into the same
 * IVariablesContext shape the menu callback receives.
 */
async function buildVariablesContextForLocal(
  session: vscode.DebugSession,
  frameId: number,
  variableName: string,
): Promise<{
  sessionId: string;
  container: DapScope;
  variable: DapVariable;
}> {
  const scopesResp = (await session.customRequest("scopes", { frameId })) as {
    scopes: DapScope[];
  };

  // The .NET adapter labels the user-locals scope "Locals". Defensively also
  // accept "Local" or any non-expensive scope that contains our variable.
  const candidateScopes = scopesResp.scopes.filter((s) => !s.expensive);
  const seenVarNames: string[] = [];
  for (const scope of candidateScopes) {
    const varsResp = (await session.customRequest("variables", {
      variablesReference: scope.variablesReference,
    })) as { variables: DapVariable[] };
    for (const v of varsResp.variables) {
      seenVarNames.push(`${scope.name}/${v.name}`);
    }
    // Prefer evaluateName (the canonical DAP-blessed C# expression for the
    // variable) over name. The .NET adapter prefixes name with the type, so
    // a local `person` of type `Person` arrives as `name: "person [Person]"`
    // while `evaluateName: "person"`. Our extension's own resolveEvaluatableTarget
    // uses evaluateName for exactly this reason.
    const found =
      varsResp.variables.find((v) => v.evaluateName === variableName) ??
      varsResp.variables.find((v) => v.name === variableName);
    if (found) {
      return {
        sessionId: session.id,
        container: scope,
        variable: found,
      };
    }
  }
  throw new Error(
    `could not find local variable '${variableName}' in any non-expensive scope of frame ${frameId}; ` +
      `scopes: [${scopesResp.scopes.map((s) => `${s.name}(expensive=${s.expensive})`).join(", ")}]; ` +
      `variables: [${seenVarNames.join(", ")}]`,
  );
}

/**
 * Read the file-backed trace log that extension.ts populates when running
 * under CSHARP_COPY_AS_JSON_E2E=1. Every trace() and showError() line is
 * mirrored there. We always return a string -- never throw -- because this
 * is itself diagnostic code that runs INSIDE failure messages, and a thrown
 * "ENOENT: test.trace.log" would mask the original assertion failure.
 */
async function readTraceLog(traceLogAbs: string): Promise<string> {
  try {
    const text = await fs.readFile(traceLogAbs, "utf8");
    return text.length > 0
      ? text
      : "(trace log exists but is empty -- extension produced no output; " +
          "did activate() run with CSHARP_COPY_AS_JSON_E2E=1?)";
  } catch (err) {
    return (
      `(could not read ${traceLogAbs}: ${(err as Error).message}; ` +
      "extension may have failed to create the file at activation)"
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
