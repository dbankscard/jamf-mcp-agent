import { describe, it, expect } from 'vitest';
import { runWithContext, getRequestId, getJobType } from './context.js';

describe('context', () => {
  it('provides requestId within context', async () => {
    let capturedId: string | undefined;

    await runWithContext(() => {
      capturedId = getRequestId();
    });

    expect(capturedId).toBeDefined();
    expect(typeof capturedId).toBe('string');
    expect(capturedId!.length).toBeGreaterThan(0);
  });

  it('provides jobType within context', async () => {
    let capturedType: string | undefined;

    await runWithContext(() => {
      capturedType = getJobType();
    }, 'compliance');

    expect(capturedType).toBe('compliance');
  });

  it('returns undefined outside context', () => {
    expect(getRequestId()).toBeUndefined();
    expect(getJobType()).toBeUndefined();
  });

  it('generates unique requestIds', async () => {
    const ids: string[] = [];

    await runWithContext(() => {
      ids.push(getRequestId()!);
    });

    await runWithContext(() => {
      ids.push(getRequestId()!);
    });

    expect(ids[0]).not.toBe(ids[1]);
  });

  it('works with async functions', async () => {
    let capturedId: string | undefined;

    await runWithContext(async () => {
      await new Promise(r => setTimeout(r, 10));
      capturedId = getRequestId();
    });

    expect(capturedId).toBeDefined();
  });

  it('returns result from sync function', () => {
    const result = runWithContext(() => 42);
    expect(result).toBe(42);
  });

  it('returns result from async function', async () => {
    const result = await runWithContext(async () => 'async-result');
    expect(result).toBe('async-result');
  });
});
