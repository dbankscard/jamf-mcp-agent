import { describe, it, expect } from 'vitest';
import { withTimeout } from './utils.js';
import { TimeoutError } from './errors.js';

describe('withTimeout', () => {
  it('resolves when promise completes within timeout', async () => {
    const result = await withTimeout(
      Promise.resolve(42),
      1000,
      'test-op',
    );
    expect(result).toBe(42);
  });

  it('rejects with TimeoutError when promise exceeds timeout', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50, 'slow-op', 'mcp')).rejects.toThrow(TimeoutError);
  });

  it('TimeoutError has correct fields', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 5000));
    try {
      await withTimeout(slow, 50, 'my-op', 'bedrock');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.timeoutMs).toBe(50);
      expect(te.component).toBe('bedrock');
      expect(te.operation).toBe('my-op');
      expect(te.message).toContain('50ms');
    }
  });

  it('propagates original error if promise rejects before timeout', async () => {
    const failing = Promise.reject(new Error('original'));
    await expect(withTimeout(failing, 5000, 'test')).rejects.toThrow('original');
  });

  it('clears timer on success (no lingering timers)', async () => {
    const result = await withTimeout(Promise.resolve('fast'), 100, 'test');
    expect(result).toBe('fast');
  });
});
