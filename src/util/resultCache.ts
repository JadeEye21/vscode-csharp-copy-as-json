/**
 * Frame-scoped cache of serialized JSON results (PBI-011).
 *
 * Key shape: `(sessionId, threadId, frameId, expression)`. We collapse it
 * into a single string with `\u0000` as the field separator because:
 *   - DAP `sessionId`s and the C# expressions we resolve via
 *     `resolveEvaluatableTarget` cannot contain a NUL byte (the latter come
 *     from the .NET adapter's `evaluateName`/`name` fields, both UTF-8 source
 *     identifiers);
 *   - `Map<string, string>` lookups are O(1) and avoid the allocation cost
 *     of a nested-Map structure.
 *
 * Lifecycle is managed by `extension.ts`: on `onDidChangeActiveStackItem`
 * we evict per-thread, on `onDidTerminateDebugSession` we evict per-session.
 *
 * Intentionally module-free of `vscode` so it can be unit-tested without
 * an Electron host.
 */
export class ResultCache {
  private readonly entries = new Map<string, string>();

  put(
    sessionId: string,
    threadId: number,
    frameId: number,
    expression: string,
    json: string,
  ): void {
    this.entries.set(toKey(sessionId, threadId, frameId, expression), json);
  }

  get(
    sessionId: string,
    threadId: number,
    frameId: number,
    expression: string,
  ): string | undefined {
    return this.entries.get(toKey(sessionId, threadId, frameId, expression));
  }

  /**
   * Drop every entry belonging to `(sessionId, threadId)`. Called when the
   * active stack item changes inside that thread (step, continue, or
   * Call-Stack-view frame switch). Per the PBI-011 spec we evict eagerly
   * rather than try to detect "same thread, different frameId" because the
   * test surface stays smaller and a redundant evict never serves stale
   * data.
   */
  clearThread(sessionId: string, threadId: number): void {
    const prefix = `${sessionId}\u0000${threadId}\u0000`;
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) {
        this.entries.delete(k);
      }
    }
  }

  /**
   * Drop every entry belonging to `sessionId`. Called on
   * `onDidTerminateDebugSession`.
   */
  clearSession(sessionId: string): void {
    const prefix = `${sessionId}\u0000`;
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) {
        this.entries.delete(k);
      }
    }
  }

  clearAll(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

function toKey(
  sessionId: string,
  threadId: number,
  frameId: number,
  expression: string,
): string {
  return `${sessionId}\u0000${threadId}\u0000${frameId}\u0000${expression}`;
}
