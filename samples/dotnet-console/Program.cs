using System;
using System.Collections.Generic;
using System.Threading;

namespace SampleApp;

public class Person
{
    public string Name { get; init; } = "";
    public int Age { get; init; }
    public List<Person> Friends { get; init; } = new();
}

public class Trap
{
    /// <summary>Property whose getter sleeps to exercise the extension's evaluate timeout.</summary>
    public int Slow
    {
        get
        {
            Thread.Sleep(20_000);
            return 42;
        }
    }
}

public static class Program
{
    public static void Main()
    {
        var person = new Person
        {
            Name = "Ada",
            Age = 36,
            Friends = new List<Person>
            {
                new() { Name = "Grace", Age = 85 },
                new() { Name = "Linus", Age = 54 },
            },
        };

        var counts = new Dictionary<string, int>
        {
            ["apples"] = 3,
            ["bananas"] = 7,
        };

        var now = DateTime.UtcNow;
        var trap = new Trap();

        // Set a breakpoint on the next line and right-click `person`,
        // `counts`, `now`, or `trap.Slow` in the Variables view, then
        // choose "Copy as JSON" to exercise the extension end-to-end.
        Console.WriteLine($"Ready: {person.Name}, {counts.Count} kinds of fruit, now={now:o}, trap={trap is not null}");
    }
}
