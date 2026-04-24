/**
 * Frame-stability check for Copy as JSON.
 *
 * Background: every `await` inside the command handler is a yield point at
 * which the user can step or hit Continue. The DAP `evaluate` request takes a
 * `frameId` that becomes invalid the instant the debug session resumes, and
 * the .NET adapters then reject the evaluate with an opaque message. We
 * defend against that by capturing the focused frame once and re-validating
 * before every subsequent evaluate dispatch.
 *
 * This module is intentionally pure (no `vscode` import). The caller is
 * responsible for snapshotting the live `vscode.debug` state into a
 * `CurrentSnapshot` and passing it in. That keeps the decision matrix
 * exhaustively unit-testable without an Electron host.
 */

export interface CapturedFrame {
  sessionId: string;
  frameId: number;
  threadId: number;
}

export interface CurrentSnapshot {
  /**
   * `vscode.debug.activeDebugSession?.id`. `undefined` if the session ended
   * (rare) or focus moved to a non-debug context.
   */
  activeSessionId: string | undefined;
  /**
   * Populated iff `vscode.debug.activeStackItem instanceof DebugStackFrame`.
   * `undefined` if the user clicked Continue (debugger resumed; no focused
   * frame), or focus is on a `DebugThread` rather than a frame, or there is no
   * active stack item at all.
   */
  activeFrame:
    | { sessionId: string; frameId: number; threadId: number }
    | undefined;
}

export type StabilityResult = { ok: true } | { ok: false; reason: string };

/**
 * The single canonical "session moved" string. Reused by `extension.ts` for
 * every pre-evaluate guard (the original `arg.sessionId` race from PBI-001,
 * the post-side-effect-warning re-capture, and the per-attempt re-check) so
 * users see the same message regardless of which await boundary tripped, and
 * so tests can match on a single phrase.
 */
export const SESSION_MOVED_MESSAGE =
  'Active debug session changed; please re-trigger Copy as JSON.';

/**
 * Returns `{ok: true}` only when the focused frame in `current` matches
 * `captured` in all three fields. Any divergence -- session ended, session
 * id changed, no focused frame, frame's session id changed, frameId changed,
 * threadId changed -- collapses to `{ok: false, reason: SESSION_MOVED_MESSAGE}`.
 *
 * The frameId AND threadId are both checked because some adapters (and some
 * step-into-async paths) can recycle a frameId across a thread switch; a frame
 * that has the same numeric id but lives on a different thread is no longer
 * the same frame for evaluate purposes.
 */
export function checkFrameStability(
  captured: CapturedFrame,
  current: CurrentSnapshot,
): StabilityResult {
  if (
    current.activeSessionId === undefined ||
    current.activeSessionId !== captured.sessionId
  ) {
    return { ok: false, reason: SESSION_MOVED_MESSAGE };
  }
  const f = current.activeFrame;
  if (f === undefined) {
    return { ok: false, reason: SESSION_MOVED_MESSAGE };
  }
  if (
    f.sessionId !== captured.sessionId ||
    f.frameId !== captured.frameId ||
    f.threadId !== captured.threadId
  ) {
    return { ok: false, reason: SESSION_MOVED_MESSAGE };
  }
  return { ok: true };
}
