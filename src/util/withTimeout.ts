/**
 * Race a promise against a timeout. Resolves with the promise's value if it
 * wins; rejects with `${label} timed out after ${ms}ms` if the timer wins.
 *
 * Pure utility, intentionally free of `vscode` imports so it can be unit-tested
 * in plain Mocha without an Electron host.
 */
export function withTimeout<T>(
  p: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(stringifyError(e)));
      },
    );
  });
}

function stringifyError(err: unknown): string {
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
