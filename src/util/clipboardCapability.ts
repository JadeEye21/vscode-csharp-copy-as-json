import type * as vscode from 'vscode';

/**
 * Per-session cache of the adapter's `supportsClipboardContext` capability,
 * captured directly from the `InitializeResponse` body via a
 * `DebugAdapterTracker`.
 *
 * This module replaces the previous duck-typed read of
 * `(session as any).capabilities.supportsClipboardContext`. The `capabilities`
 * field is not part of `vscode.DebugSession`'s public API; relying on it would
 * break silently if VS Code ever hides the field.
 *
 * Lifecycle:
 *   - `extension.activate` registers a `DebugAdapterTrackerFactory` for `'*'`
 *     that creates trackers via `createCapabilityTracker(session.id)`.
 *   - The tracker writes the capability into the cache when the
 *     `InitializeResponse` arrives.
 *   - `extension.activate` also subscribes to `onDidTerminateDebugSession` and
 *     calls `clearSession(session.id)` to evict.
 *
 * Intentionally module-local state: there is exactly one extension host, and
 * the cache is keyed by the host-assigned `session.id` which is unique per
 * session even across reloads.
 */

const cache = new Map<string, boolean>();

export function setSupportsClipboardContext(
  sessionId: string,
  supports: boolean,
): void {
  cache.set(sessionId, supports);
}

/**
 * Returns the cached capability for `sessionId`, or `undefined` if no
 * `InitializeResponse` has been observed for it yet. The caller must decide
 * how to interpret a cache miss; the conservative choice is to treat it as
 * `false` so we fall through to `hover` rather than risk an unsupported
 * `clipboard` evaluate.
 */
export function getSupportsClipboardContext(
  sessionId: string,
): boolean | undefined {
  return cache.get(sessionId);
}

export function clearSession(sessionId: string): void {
  cache.delete(sessionId);
}

/**
 * Test-only: wipe the entire cache between unit tests so state from one
 * `suite` does not leak into the next.
 */
export function _clearAllForTesting(): void {
  cache.clear();
}

/**
 * Build a `DebugAdapterTracker` that watches outbound messages from the debug
 * adapter and, on the first successful `InitializeResponse`, records
 * `body.supportsClipboardContext` into the cache for `sessionId`.
 *
 * Exported (rather than inlined into `extension.ts`) so the message-extraction
 * logic can be unit-tested without spinning up a fake debug adapter or an
 * Electron host.
 */
export function createCapabilityTracker(
  sessionId: string,
): vscode.DebugAdapterTracker {
  return {
    onDidSendMessage(message: unknown): void {
      if (!isInitializeResponse(message)) {
        return;
      }
      const supports = message.body?.supportsClipboardContext === true;
      setSupportsClipboardContext(sessionId, supports);
    },
  };
}

interface InitializeResponseShape {
  type: 'response';
  command: 'initialize';
  success: true;
  body?: { supportsClipboardContext?: boolean };
}

function isInitializeResponse(
  message: unknown,
): message is InitializeResponseShape {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const m = message as {
    type?: unknown;
    command?: unknown;
    success?: unknown;
  };
  return (
    m.type === 'response' && m.command === 'initialize' && m.success === true
  );
}
