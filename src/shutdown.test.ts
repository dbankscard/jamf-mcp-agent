import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShutdownManager } from './shutdown.js';

describe('ShutdownManager', () => {
  let manager: ShutdownManager;

  beforeEach(() => {
    manager = new ShutdownManager();
  });

  it('starts with no in-flight operations', () => {
    expect(manager.getInFlightCount()).toBe(0);
    expect(manager.isShuttingDown()).toBe(false);
  });

  it('tracks and releases operations', () => {
    const release1 = manager.trackOperation('op1');
    const release2 = manager.trackOperation('op2');
    expect(manager.getInFlightCount()).toBe(2);

    release1();
    expect(manager.getInFlightCount()).toBe(1);

    release2();
    expect(manager.getInFlightCount()).toBe(0);
  });

  it('rejects new operations after shutdown starts', async () => {
    // Start shutdown in background (don't await — it would exit)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    void manager.shutdown();

    expect(manager.isShuttingDown()).toBe(true);
    expect(() => manager.trackOperation('late')).toThrow('shutting down');

    mockExit.mockRestore();
  });

  it('runs cleanup functions during shutdown', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const cleanup1 = vi.fn(async () => {});
    const cleanup2 = vi.fn(async () => {});

    manager.onShutdown(cleanup1);
    manager.onShutdown(cleanup2);

    await manager.shutdown();

    expect(cleanup1).toHaveBeenCalled();
    expect(cleanup2).toHaveBeenCalled();
    mockExit.mockRestore();
  });

  it('handles cleanup errors gracefully', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    manager.onShutdown(async () => { throw new Error('cleanup fail'); });
    manager.onShutdown(async () => {}); // should still run

    await expect(manager.shutdown()).resolves.toBeUndefined();
    mockExit.mockRestore();
  });

  it('waits for in-flight operations before cleanup', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const order: string[] = [];

    const release = manager.trackOperation('slow');
    manager.onShutdown(async () => { order.push('cleanup'); });

    // Release after a short delay
    setTimeout(() => {
      order.push('released');
      release();
    }, 100);

    await manager.shutdown();

    expect(order).toEqual(['released', 'cleanup']);
    mockExit.mockRestore();
  });

  it('only shuts down once', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const cleanup = vi.fn(async () => {});
    manager.onShutdown(cleanup);

    await manager.shutdown();
    await manager.shutdown();

    expect(cleanup).toHaveBeenCalledTimes(1);
    mockExit.mockRestore();
  });
});
