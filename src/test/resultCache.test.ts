import { strict as assert } from 'node:assert';
import { ResultCache } from '../util/resultCache.js';

suite('ResultCache', () => {
  test('get returns undefined on miss', () => {
    const c = new ResultCache();
    assert.equal(c.get('s', 1, 1, 'x'), undefined);
  });

  test('put then get round-trips', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'person.Age', '{"v":42}');
    assert.equal(c.get('s', 1, 100, 'person.Age'), '{"v":42}');
  });

  test('different frameId is a miss', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'x', 'a');
    assert.equal(c.get('s', 1, 101, 'x'), undefined);
  });

  test('different threadId is a miss', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'x', 'a');
    assert.equal(c.get('s', 2, 100, 'x'), undefined);
  });

  test('different sessionId is a miss', () => {
    const c = new ResultCache();
    c.put('s1', 1, 100, 'x', 'a');
    assert.equal(c.get('s2', 1, 100, 'x'), undefined);
  });

  test('different expression is a miss', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'a', 'A');
    c.put('s', 1, 100, 'b', 'B');
    assert.equal(c.get('s', 1, 100, 'a'), 'A');
    assert.equal(c.get('s', 1, 100, 'b'), 'B');
  });

  test('clearThread evicts only that thread', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'x', 'thread1');
    c.put('s', 2, 100, 'x', 'thread2');
    c.clearThread('s', 1);
    assert.equal(c.get('s', 1, 100, 'x'), undefined);
    assert.equal(c.get('s', 2, 100, 'x'), 'thread2');
  });

  test('clearThread evicts all frames within the thread', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'x', 'a');
    c.put('s', 1, 101, 'x', 'b');
    c.put('s', 1, 102, 'x', 'c');
    c.clearThread('s', 1);
    assert.equal(c.size(), 0);
  });

  test('clearSession evicts only that session', () => {
    const c = new ResultCache();
    c.put('s1', 1, 100, 'x', 'A');
    c.put('s2', 1, 100, 'x', 'B');
    c.clearSession('s1');
    assert.equal(c.get('s1', 1, 100, 'x'), undefined);
    assert.equal(c.get('s2', 1, 100, 'x'), 'B');
  });

  test('clearSession evicts across threads and frames', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'x', 'a');
    c.put('s', 1, 101, 'y', 'b');
    c.put('s', 2, 100, 'z', 'c');
    c.clearSession('s');
    assert.equal(c.size(), 0);
  });

  test('clearAll empties the cache', () => {
    const c = new ResultCache();
    c.put('s1', 1, 1, 'x', 'A');
    c.put('s2', 2, 2, 'y', 'B');
    c.clearAll();
    assert.equal(c.size(), 0);
  });

  test('keys with overlapping numeric prefixes do not collide', () => {
    // Without a delimiter, threadId=1 + frameId=23 could collide with
    // threadId=12 + frameId=3. The NUL separator prevents this.
    const c = new ResultCache();
    c.put('s', 1, 23, 'x', 'A');
    c.put('s', 12, 3, 'x', 'B');
    assert.equal(c.get('s', 1, 23, 'x'), 'A');
    assert.equal(c.get('s', 12, 3, 'x'), 'B');
  });

  test('expressions containing dots and brackets round-trip', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'arr[0].Inner.Field', 'A');
    assert.equal(c.get('s', 1, 100, 'arr[0].Inner.Field'), 'A');
  });

  test('put overwrites previous value for same key', () => {
    const c = new ResultCache();
    c.put('s', 1, 100, 'x', 'old');
    c.put('s', 1, 100, 'x', 'new');
    assert.equal(c.get('s', 1, 100, 'x'), 'new');
    assert.equal(c.size(), 1);
  });
});
