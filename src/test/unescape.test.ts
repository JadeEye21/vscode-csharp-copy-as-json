import { strict as assert } from 'node:assert';
import { unescapeCsharpString } from '../util/unescape.js';

suite('unescapeCsharpString', () => {
  test('round-trips a typical STJ result with \\n and \\u escapes', () => {
    // What the .NET adapter actually returns for
    //   System.Text.Json.JsonSerializer.Serialize(x, new(){ WriteIndented = true })
    // when x = { k = 1 }: the C# literal of `{\n  "k": 1\n}` is
    //   "\"{\\n  \\u0022k\\u0022: 1\\n}\""
    // (escaped here as a JS string).
    const literal = '"{\\n  \\u0022k\\u0022: 1\\n}"';
    const expected = '{\n  "k": 1\n}';
    assert.equal(unescapeCsharpString(literal), expected);
  });

  test('idempotent on already-raw JSON input', () => {
    const raw = '{\n  "k": 1\n}';
    assert.equal(unescapeCsharpString(raw), raw);
  });

  test('preserves embedded backslashes', () => {
    const literal = '"a\\\\b"';
    assert.equal(unescapeCsharpString(literal), 'a\\b');
  });

  test('handles tab, carriage return, form feed', () => {
    const literal = '"\\t\\r\\f"';
    assert.equal(unescapeCsharpString(literal), '\t\r\f');
  });

  test('returns input unchanged when not quoted', () => {
    assert.equal(unescapeCsharpString('not a literal'), 'not a literal');
  });

  test('returns empty string unchanged', () => {
    assert.equal(unescapeCsharpString(''), '');
  });

  test('handles a 2-char input gracefully', () => {
    assert.equal(unescapeCsharpString('""'), '');
  });

  test('falls back to manual unescaper for C# `\\xNN` (rejected by JSON.parse)', () => {
    // JSON does not accept \xNN; the manual fallback must.
    const literal = '"a\\x41b"';
    assert.equal(unescapeCsharpString(literal), 'aAb');
  });

  test('passes non-string input through unchanged', () => {
    // Defensive: function is typed `string` but we should not throw on bad data.
    const garbage = 42 as unknown as string;
    assert.equal(unescapeCsharpString(garbage), garbage);
  });
});
