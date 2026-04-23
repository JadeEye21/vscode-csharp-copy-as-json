import { strict as assert } from 'node:assert';
import {
  buildNewtonsoftExpression,
  buildSystemTextJsonExpression,
  resolveEvaluatableTarget,
  type IVariablesContext,
} from '../util/expression.js';

function ctx(partial: Partial<IVariablesContext['variable']> & { name: string }, container?: IVariablesContext['container']): IVariablesContext {
  return {
    sessionId: 'session-1',
    container: container ?? { variablesReference: 0, name: 'Locals' },
    variable: { variablesReference: 0, value: '...', ...partial },
  };
}

suite('resolveEvaluatableTarget', () => {
  test('uses evaluateName when present', () => {
    const r = resolveEvaluatableTarget(ctx({ name: 'person', evaluateName: 'this.person' }));
    assert.deepEqual(r, { ok: true, expression: 'this.person' });
  });

  test('falls back to <parent.expression>.<name> when container is an EvaluateArguments', () => {
    const r = resolveEvaluatableTarget(
      ctx({ name: 'Age' }, { expression: 'person' } as IVariablesContext['container']),
    );
    assert.deepEqual(r, { ok: true, expression: 'person.Age' });
  });

  test('falls back to bare name as last resort', () => {
    const r = resolveEvaluatableTarget(ctx({ name: 'localVar' }));
    assert.deepEqual(r, { ok: true, expression: 'localVar' });
  });

  test('rejects [Raw View] synthetic node', () => {
    const r = resolveEvaluatableTarget(ctx({ name: '[Raw View]' }));
    assert.equal(r.ok, false);
  });

  test('rejects Static members synthetic node', () => {
    const r = resolveEvaluatableTarget(ctx({ name: 'Static members' }));
    assert.equal(r.ok, false);
  });

  test('does not reject integer indexers like [0]', () => {
    const r = resolveEvaluatableTarget(ctx({ name: '[0]', evaluateName: 'arr[0]' }));
    assert.deepEqual(r, { ok: true, expression: 'arr[0]' });
  });

  test('returns reason when variable is missing', () => {
    const bad = { sessionId: 's', container: {}, variable: undefined } as unknown as IVariablesContext;
    const r = resolveEvaluatableTarget(bad);
    assert.equal(r.ok, false);
  });

  test('returns reason when name is empty', () => {
    const r = resolveEvaluatableTarget(ctx({ name: '' }));
    assert.equal(r.ok, false);
  });
});

suite('expression builders', () => {
  test('System.Text.Json expression is fully qualified and casts to object', () => {
    const expr = buildSystemTextJsonExpression('person');
    assert.match(expr, /^System\.Text\.Json\.JsonSerializer\.Serialize\(\(object\)\(person\),/);
    assert.match(expr, /WriteIndented = true/);
  });

  test('Newtonsoft expression is fully qualified and uses Indented formatting', () => {
    const expr = buildNewtonsoftExpression('person');
    assert.match(expr, /^Newtonsoft\.Json\.JsonConvert\.SerializeObject\(\(object\)\(person\),/);
    assert.match(expr, /Newtonsoft\.Json\.Formatting\.Indented/);
  });

  test('builders accept complex subexpressions', () => {
    const expr = buildSystemTextJsonExpression('this.repo.Items[0]');
    assert.ok(expr.includes('(this.repo.Items[0])'));
  });
});
