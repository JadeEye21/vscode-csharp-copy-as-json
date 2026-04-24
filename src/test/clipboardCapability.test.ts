import { strict as assert } from 'node:assert/strict';
import {
  _clearAllForTesting,
  clearSession,
  createCapabilityTracker,
  getSupportsClipboardContext,
  setSupportsClipboardContext,
} from '../util/clipboardCapability.js';

suite('clipboardCapability cache', () => {
  setup(() => {
    _clearAllForTesting();
  });

  test('get returns undefined for an unknown session', () => {
    assert.equal(getSupportsClipboardContext('never-seen'), undefined);
  });

  test('set then get round-trips both true and false', () => {
    setSupportsClipboardContext('s1', true);
    setSupportsClipboardContext('s2', false);
    assert.equal(getSupportsClipboardContext('s1'), true);
    assert.equal(getSupportsClipboardContext('s2'), false);
  });

  test('clearSession evicts only the requested key', () => {
    setSupportsClipboardContext('s1', true);
    setSupportsClipboardContext('s2', true);
    clearSession('s1');
    assert.equal(getSupportsClipboardContext('s1'), undefined);
    assert.equal(getSupportsClipboardContext('s2'), true);
  });

  test('clearSession on unknown key is a no-op', () => {
    clearSession('never-seen');
    assert.equal(getSupportsClipboardContext('never-seen'), undefined);
  });

  test('_clearAllForTesting wipes everything', () => {
    setSupportsClipboardContext('s1', true);
    setSupportsClipboardContext('s2', false);
    _clearAllForTesting();
    assert.equal(getSupportsClipboardContext('s1'), undefined);
    assert.equal(getSupportsClipboardContext('s2'), undefined);
  });
});

suite('createCapabilityTracker', () => {
  setup(() => {
    _clearAllForTesting();
  });

  function fire(tracker: ReturnType<typeof createCapabilityTracker>, msg: unknown): void {
    // `onDidSendMessage` is optional in the interface; we always populate it.
    tracker.onDidSendMessage!(msg);
  }

  test('caches true on InitializeResponse with supportsClipboardContext: true', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, {
      type: 'response',
      command: 'initialize',
      success: true,
      body: { supportsClipboardContext: true },
    });
    assert.equal(getSupportsClipboardContext('s1'), true);
  });

  test('caches false on InitializeResponse with supportsClipboardContext: false', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, {
      type: 'response',
      command: 'initialize',
      success: true,
      body: { supportsClipboardContext: false },
    });
    assert.equal(getSupportsClipboardContext('s1'), false);
  });

  test('caches false when InitializeResponse omits supportsClipboardContext', () => {
    // Per DAP, the field is optional; absence means "not advertised".
    const tracker = createCapabilityTracker('s1');
    fire(tracker, {
      type: 'response',
      command: 'initialize',
      success: true,
      body: {},
    });
    assert.equal(getSupportsClipboardContext('s1'), false);
  });

  test('caches false when InitializeResponse has no body at all', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, { type: 'response', command: 'initialize', success: true });
    assert.equal(getSupportsClipboardContext('s1'), false);
  });

  test('ignores failed InitializeResponse', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, {
      type: 'response',
      command: 'initialize',
      success: false,
      message: 'adapter failed to initialize',
    });
    assert.equal(getSupportsClipboardContext('s1'), undefined);
  });

  test('ignores responses to other commands', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, {
      type: 'response',
      command: 'launch',
      success: true,
      body: { supportsClipboardContext: true }, // shouldn't matter
    });
    assert.equal(getSupportsClipboardContext('s1'), undefined);
  });

  test('ignores DAP events (e.g. initialized event)', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, { type: 'event', event: 'initialized' });
    assert.equal(getSupportsClipboardContext('s1'), undefined);
  });

  test('ignores requests routed back through the tracker', () => {
    // `onDidSendMessage` only fires for adapter -> client traffic in
    // production, but we still defend against any non-response shape.
    const tracker = createCapabilityTracker('s1');
    fire(tracker, { type: 'request', command: 'initialize', seq: 1 });
    assert.equal(getSupportsClipboardContext('s1'), undefined);
  });

  test('ignores null / undefined / non-object messages', () => {
    const tracker = createCapabilityTracker('s1');
    fire(tracker, null);
    fire(tracker, undefined);
    fire(tracker, 'string');
    fire(tracker, 42);
    assert.equal(getSupportsClipboardContext('s1'), undefined);
  });

  test('two trackers with different session ids cache independently', () => {
    const t1 = createCapabilityTracker('s1');
    const t2 = createCapabilityTracker('s2');
    fire(t1, {
      type: 'response',
      command: 'initialize',
      success: true,
      body: { supportsClipboardContext: true },
    });
    fire(t2, {
      type: 'response',
      command: 'initialize',
      success: true,
      body: { supportsClipboardContext: false },
    });
    assert.equal(getSupportsClipboardContext('s1'), true);
    assert.equal(getSupportsClipboardContext('s2'), false);
  });

  test('coerces a non-boolean supportsClipboardContext to false', () => {
    // Defense in depth: if a buggy adapter sends a string or number, we
    // refuse to upgrade to clipboard.
    const tracker = createCapabilityTracker('s1');
    fire(tracker, {
      type: 'response',
      command: 'initialize',
      success: true,
      body: { supportsClipboardContext: 'yes' as unknown as boolean },
    });
    assert.equal(getSupportsClipboardContext('s1'), false);
  });
});
