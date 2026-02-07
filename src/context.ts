import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface RequestContext {
  requestId: string;
  jobType?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(
  fn: () => T | Promise<T>,
  jobType?: string,
): T | Promise<T> {
  const ctx: RequestContext = {
    requestId: randomUUID(),
    jobType,
  };
  return storage.run(ctx, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function getJobType(): string | undefined {
  return storage.getStore()?.jobType;
}
