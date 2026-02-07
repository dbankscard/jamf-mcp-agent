import { TimeoutError, type ErrorComponent } from './errors.js';

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  component: ErrorComponent = 'mcp',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new TimeoutError(`${label} timed out after ${ms}ms`, {
          component,
          operation: label,
          timeoutMs: ms,
        }),
      );
    }, ms);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
