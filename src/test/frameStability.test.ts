import { strict as assert } from 'node:assert/strict';
import {
  checkFrameStability,
  SESSION_MOVED_MESSAGE,
  type CapturedFrame,
  type CurrentSnapshot,
} from '../util/frameStability.js';

const captured: CapturedFrame = {
  sessionId: 'session-A',
  frameId: 1001,
  threadId: 7,
};

function snapshot(overrides: Partial<CurrentSnapshot> = {}): CurrentSnapshot {
  return {
    activeSessionId: 'session-A',
    activeFrame: {
      sessionId: 'session-A',
      frameId: 1001,
      threadId: 7,
    },
    ...overrides,
  };
}

suite('checkFrameStability', () => {
  test('ok when session and frame match in all three fields', () => {
    const r = checkFrameStability(captured, snapshot());
    assert.equal(r.ok, true);
  });

  test('moved when activeSessionId is undefined (session terminated mid-flight)', () => {
    const r = checkFrameStability(
      captured,
      snapshot({ activeSessionId: undefined }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, SESSION_MOVED_MESSAGE);
    }
  });

  test('moved when activeSessionId differs from captured.sessionId', () => {
    const r = checkFrameStability(
      captured,
      snapshot({ activeSessionId: 'session-B' }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, SESSION_MOVED_MESSAGE);
    }
  });

  test('moved when activeFrame is undefined (user clicked Continue)', () => {
    const r = checkFrameStability(
      captured,
      snapshot({ activeFrame: undefined }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, SESSION_MOVED_MESSAGE);
    }
  });

  test('moved when activeFrame.sessionId differs (focus jumped to another session)', () => {
    const r = checkFrameStability(
      captured,
      snapshot({
        activeFrame: { sessionId: 'session-B', frameId: 1001, threadId: 7 },
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, SESSION_MOVED_MESSAGE);
    }
  });

  test('moved when frameId differs (user stepped: same thread, new frame)', () => {
    const r = checkFrameStability(
      captured,
      snapshot({
        activeFrame: { sessionId: 'session-A', frameId: 1002, threadId: 7 },
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, SESSION_MOVED_MESSAGE);
    }
  });

  test('moved when threadId differs even if frameId matches (recycled id on different thread)', () => {
    const r = checkFrameStability(
      captured,
      snapshot({
        activeFrame: { sessionId: 'session-A', frameId: 1001, threadId: 9 },
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, SESSION_MOVED_MESSAGE);
    }
  });

  test('moved when both session and frame are entirely different', () => {
    const r = checkFrameStability(
      captured,
      snapshot({
        activeSessionId: 'session-B',
        activeFrame: { sessionId: 'session-B', frameId: 9999, threadId: 13 },
      }),
    );
    assert.equal(r.ok, false);
  });

  test('moved when session matches but no stack frame (user resumed)', () => {
    const r = checkFrameStability(
      captured,
      snapshot({ activeSessionId: 'session-A', activeFrame: undefined }),
    );
    assert.equal(r.ok, false);
  });
});

suite('SESSION_MOVED_MESSAGE', () => {
  test('matches the canonical user-facing string verbatim', () => {
    // If this assertion fails, update both this string AND the call sites
    // in extension.ts that rely on users / docs seeing the same wording.
    assert.equal(
      SESSION_MOVED_MESSAGE,
      'Active debug session changed; please re-trigger Copy as JSON.',
    );
  });
});
