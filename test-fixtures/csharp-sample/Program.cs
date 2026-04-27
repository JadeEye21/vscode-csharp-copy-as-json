// Fixture for the PBI-010 real-debugger e2e harness.
//
// The single `person` instance below is deliberately tricky to JSON-serialize.
// Every field is chosen to exercise a real-world serialization edge case:
//
//   - Guid                       -> STJ writes as a string ("xxxxxxxx-xxxx-...")
//   - decimal Salary             -> STJ writes as a JSON number, full precision
//   - DateTime BirthDate (UTC)   -> STJ writes ISO 8601 with trailing 'Z'
//   - AccountType Tier (enum)    -> STJ default writes the integer value, NOT
//                                   the name (we assert the int; production
//                                   users who want names can configure their
//                                   own JsonStringEnumConverter)
//   - Address WorkAddress (null) -> nullable reference -> JSON null
//   - Person? Manager (null)     -> nullable + recursive shape (would loop if
//                                   serialized non-null; we keep it null to
//                                   prove the shape, not the cycle handling)
//   - List<string> Hobbies       -> generic collection -> JSON array
//   - int[] LuckyNumbers         -> raw array
//   - Dictionary<string,int>     -> object with int values
//   - string Description         -> embedded unicode escape AND embedded
//                                   literal '\n' (round-trip both)
//   - string Name                -> embedded double-quote (escape correctness)
//
// The e2e test breaks on the marked line, programmatically constructs an
// IVariablesContext for `person`, runs the Copy as JSON command, persists
// the clipboard payload to test.json, RESUMES the debugger, waits for the
// process to exit, and only THEN re-reads test.json from disk and asserts.
// Separating "act" from "assert" guarantees the assert phase never races
// against a paused debugger or a hanging adapter.
//
// Do NOT change the literal text "BREAK_HERE_LINE" without also updating the
// breakpoint discovery in copyAsJson.e2e.test.ts. The test scans this file
// for a line whose trimmed content STARTS with `// BREAK_HERE_LINE`, so the
// docstring above (which only mentions the token) is intentionally safe.

using System;
using System.Collections.Generic;
// Imported for the explicit `typeof(JsonSerializer)` reference in Main().
// See the comment there for why this matters; without it, the coreclr
// expression evaluator at our breakpoint cannot resolve
// `System.Text.Json.JsonSerializer` because the assembly is part of the
// shared framework but only loaded on demand.
using System.Text.Json;

namespace CopyAsJsonSample;

internal enum AccountType
{
    Standard = 0,
    Premium = 1,
    Enterprise = 2,
}

internal sealed record Address(string Street, string City, string CountryCode);

internal sealed record Person(
    Guid Id,
    string Name,
    int Age,
    bool IsActive,
    decimal Salary,
    DateTime BirthDate,
    AccountType Tier,
    Address HomeAddress,
    Address? WorkAddress,
    List<string> Hobbies,
    int[] LuckyNumbers,
    Dictionary<string, int> Scores,
    string Description,
    Person? Manager);

internal static class Program
{
    private static int Main()
    {
        // Force System.Text.Json.dll fully online BEFORE the breakpoint. The
        // coreclr debugger's C# expression evaluator can only resolve types
        // (and JIT-compile generics) from assemblies that are already loaded
        // AND have the relevant methods already touched by the runtime. STJ
        // ships in the .NET shared framework but is loaded on demand, so
        // without this priming the evaluator returns
        //   error CS0234: The type or namespace name 'Json' does not exist
        //   in the namespace 'System.Text' (are you missing an assembly
        //   reference?)
        // when the extension issues
        //   System.Text.Json.JsonSerializer.Serialize(...).
        //
        // We do TWO things, in order, because each defends a different layer:
        //   1. `typeof(JsonSerializer)` resolves the type token, which forces
        //      the CLR to bind System.Text.Json.dll into the AppDomain.
        //   2. An actual `JsonSerializer.Serialize(...)` call forces the JIT
        //      to materialize the generic instantiation, so the evaluator's
        //      synthesized call site does not have to do that work itself
        //      (some debugger evaluators refuse generic instantiation in
        //      function evaluation mode).
        // Discarded to `_` so the lines are unmistakably load primers, not
        // real logic. Real user projects almost always pull STJ in
        // transitively (ASP.NET, logging, config) so this fixture is the
        // pathological case, not the common one.
        _ = typeof(JsonSerializer);
        _ = JsonSerializer.Serialize(0);

        var person = new Person(
            Id: Guid.Parse("12345678-1234-1234-1234-123456789012"),
            Name: "Ada \"Lovelace\"",
            Age: 36,
            IsActive: true,
            Salary: 12345.67m,
            BirthDate: new DateTime(1815, 12, 10, 0, 0, 0, DateTimeKind.Utc),
            Tier: AccountType.Premium,
            HomeAddress: new Address("10 Downing St", "London", "GB"),
            WorkAddress: null,
            Hobbies: new List<string> { "math", "writing", "tea-time" },
            LuckyNumbers: new[] { 7, 13, 42 },
            Scores: new Dictionary<string, int>
            {
                ["analytical"] = 99,
                ["narrative"] = 87,
            },
            Description: "First programmer; loves \u2728 unicode \u2728\nand newlines.",
            Manager: null);

        // BREAK_HERE_LINE - the e2e test sets a breakpoint on the line BELOW.
        Console.WriteLine($"hello, {person.Name}");

        return 0;
    }
}
