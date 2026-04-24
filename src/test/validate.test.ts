import { strict as assert } from 'node:assert';
import {
  isValidJson,
  looksLikeError,
  validateEvaluateResult,
} from '../util/validate.js';
import { unescapeCsharpString } from '../util/unescape.js';

const id = (s: string): string => s;

suite('validateEvaluateResult', () => {
  test('rejects empty string', () => {
    const v = validateEvaluateResult('', id, 'ctx');
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.reason, /empty/);
    }
  });

  test('rejects undefined / non-string', () => {
    const v = validateEvaluateResult(undefined, id, 'ctx');
    assert.equal(v.ok, false);
  });

  test('accepts a valid JSON object', () => {
    const v = validateEvaluateResult('{"a":1}', id, 'ctx');
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.json, '{"a":1}');
    }
  });

  test('accepts a valid JSON array', () => {
    const v = validateEvaluateResult('[1,2,3]', id, 'ctx');
    assert.equal(v.ok, true);
  });

  test('accepts JSON whose contents contain "exception" (R5 regression)', () => {
    const v = validateEvaluateResult(
      '{"name":"NullReferenceException sample"}',
      id,
      'ctx',
    );
    assert.equal(v.ok, true);
  });

  test('rejects a debugger error sentinel', () => {
    const v = validateEvaluateResult(
      'error CS0103: name does not exist in current context',
      id,
      'STJ (hover)',
    );
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.reason, /debugger error sentinel/);
      assert.match(v.reason, /STJ \(hover\)/);
    }
  });

  test('rejects "Cannot evaluate" sentinel', () => {
    const v = validateEvaluateResult('Cannot evaluate expression', id, 'ctx');
    assert.equal(v.ok, false);
  });

  test('rejects truncated, JSON-invalid result with "truncated" reason (C1)', () => {
    const v = validateEvaluateResult(
      '{ Name = "John", Age = 30...',
      id,
      'STJ (hover)',
    );
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.reason, /truncated/);
      assert.match(v.reason, /STJ \(hover\)/);
    }
  });

  test('rejects what looks like a repl-context echo (parse fails -> ctx fails)', () => {
    // Some adapters could conceivably echo the expression before the value
    // in `repl` context. We deliberately do NOT strip such echoes (no
    // confirmed adapter behavior in scope), but the parse-validation path
    // must still reject the response cleanly so the next context is tried.
    const v = validateEvaluateResult(
      '> serialize(person)\n{"a":1}',
      id,
      'STJ (repl)',
    );
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.reason, /not valid JSON/);
    }
  });

  test('runs the unescape callback before parsing (real STJ wire form)', () => {
    // .NET adapters return strings as C# string literals, e.g. the value
    // `{"a":1}` arrives as the literal `"{\"a\":1}"`. The validator must
    // unescape before parsing.
    const csharpLiteral = '"{\\"a\\":1}"';
    const v = validateEvaluateResult(
      csharpLiteral,
      unescapeCsharpString,
      'STJ (clipboard)',
    );
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.json, '{"a":1}');
    }
  });

  test('rejects an unescape result that is still not JSON (e.g. plain ToString())', () => {
    // The .NET adapter sometimes returns the call-site ToString() instead
    // of the evaluated expression result. ToString of a typical POCO is
    // not JSON; we must not paste it.
    const csharpLiteral = '"MyApp.Person"';
    const v = validateEvaluateResult(
      csharpLiteral,
      unescapeCsharpString,
      'STJ (hover)',
    );
    assert.equal(v.ok, false);
  });
});

suite('isValidJson', () => {
  test('accepts objects, arrays, primitives', () => {
    assert.ok(isValidJson('{"a":1}'));
    assert.ok(isValidJson('[1,2,3]'));
    assert.ok(isValidJson('"hello"'));
    assert.ok(isValidJson('42'));
    assert.ok(isValidJson('null'));
    assert.ok(isValidJson('true'));
  });

  test('rejects malformed input', () => {
    assert.ok(!isValidJson(''));
    assert.ok(!isValidJson('{'));
    assert.ok(!isValidJson('{ Name = "x" }'));
    assert.ok(!isValidJson('undefined'));
  });
});

suite('looksLikeError', () => {
  test('flags "error ..." prefix', () => {
    assert.ok(looksLikeError('error CS0103: foo'));
  });

  test('flags "Cannot evaluate" prefix', () => {
    assert.ok(looksLikeError('Cannot evaluate expression'));
  });

  test('flags "Cannot find" prefix', () => {
    assert.ok(looksLikeError('Cannot find symbol'));
  });

  test('does NOT flag JSON containing "exception" as substring (R5)', () => {
    assert.ok(!looksLikeError('{"name":"NullReferenceException"}'));
  });

  test('does NOT flag JSON containing the word "error"', () => {
    // No leading "error " token, just embedded.
    assert.ok(!looksLikeError('{"error":false}'));
  });

  test('does NOT flag a string that happens to contain "Cannot" lowercased', () => {
    // Anchor check: heuristic only fires at start of string.
    assert.ok(!looksLikeError('{"text":"I cannot find my keys"}'));
  });
});
