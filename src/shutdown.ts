import { logger } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

type CleanupFn = () => Promise<void>;

export class ShutdownManager {
  private cleanupFns: CleanupFn[] = [];
  private inFlight = new Map<string, number>();
  private counter = 0;
  private shuttingDown = false;
  private installed = false;

  onShutdown(fn: CleanupFn): void {
    this.cleanupFns.push(fn);
  }

  trackOperation(label: string): () => void {
    if (this.shuttingDown) {
      throw new Error(`Cannot start operation "${label}" — shutting down`);
    }
    const id = `${label}-${++this.counter}`;
    this.inFlight.set(id, Date.now());
    return () => {
      this.inFlight.delete(id);
    };
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const handler = () => void this.shutdown();
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info(`Shutdown initiated — ${this.inFlight.size} operation(s) in flight`);

    // Wait for in-flight operations with timeout
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (this.inFlight.size > 0) {
      logger.warn(`Shutdown timeout — ${this.inFlight.size} operation(s) still in flight`);
    }

    // Run cleanup functions
    for (const fn of this.cleanupFns) {
      try {
        await fn();
      } catch (err) {
        logger.error('Cleanup error', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    logger.info('Shutdown complete');
    process.exit(0);
  }
}

export const shutdownManager = new ShutdownManager();
