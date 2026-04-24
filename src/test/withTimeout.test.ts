import { strict as assert } from 'node:assert';
import { withTimeout } from '../util/withTimeout.js';

suite('withTimeout', () => {
  test('resolves when the promise wins', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'fast');
    assert.equal(result, 42);
  });

  test('rejects when the timer wins', async () => {
    const slow = new Promise<never>(() => {
      // intentionally never resolves
    });
    await assert.rejects(
      () => withTimeout(slow, 10, 'slow op'),
      /slow op timed out after 10ms/,
    );
  });

  test('propagates a rejection from the underlying promise', async () => {
    const failing = Promise.reject(new Error('boom'));
    await assert.rejects(() => withTimeout(failing, 1000, 'op'), /boom/);
  });

  test('wraps a non-Error rejection value in an Error', async () => {
    const failing = Promise.reject('plain string');
    await assert.rejects(() => withTimeout(failing, 1000, 'op'), /plain string/);
  });

  test('clears the timer on successful resolution (no leaked rejection)', async () => {
    let unhandled: unknown;
    const handler = (reason: unknown): void => {
      unhandled = reason;
    };
    process.on('unhandledRejection', handler);
    try {
      await withTimeout(Promise.resolve('ok'), 50, 'op');
      // Give the event loop a tick in case a stray timer would have fired.
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(unhandled, undefined);
    } finally {
      process.off('unhandledRejection', handler);
    }
  });
});
