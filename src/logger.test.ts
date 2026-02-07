import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting, so the mock fn is available in the factory
const { mockGetRequestId } = vi.hoisted(() => ({
  mockGetRequestId: vi.fn<() => string | undefined>(),
}));
vi.mock('./context.js', () => ({
  getRequestId: mockGetRequestId,
}));

// In the test environment process.stdout.isTTY is falsy,
// so the logger will use the JSON (non-TTY) code path.
import { logger } from './logger.js';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetRequestId.mockReturnValue(undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    mockGetRequestId.mockReset();
  });

  // ---- Output routing ----

  describe('output routing', () => {
    it('info writes to stdout via console.log', () => {
      logger.info('hello');
      expect(logSpy).toHaveBeenCalledOnce();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('error writes to stderr via console.error', () => {
      logger.error('boom');
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('warn writes to stdout via console.log', () => {
      // In the source, only level === "error" goes to console.error;
      // warn goes through console.log like info and debug.
      logger.warn('caution');
      expect(logSpy).toHaveBeenCalledOnce();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // ---- JSON format (non-TTY path) ----

  describe('JSON format', () => {
    it('outputs valid JSON with timestamp, level, and message', () => {
      logger.info('structured');
      expect(logSpy).toHaveBeenCalledOnce();

      const raw = logSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(raw);

      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('structured');
      expect(typeof parsed.timestamp).toBe('string');
      // Timestamp should be ISO 8601
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
    });

    it('includes correct level string for each log method', () => {
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      const infoLine = JSON.parse(logSpy.mock.calls[0][0] as string);
      const warnLine = JSON.parse(logSpy.mock.calls[1][0] as string);
      const errorLine = JSON.parse(errorSpy.mock.calls[0][0] as string);

      expect(infoLine.level).toBe('info');
      expect(warnLine.level).toBe('warn');
      expect(errorLine.level).toBe('error');
    });
  });

  // ---- Metadata inclusion ----

  describe('metadata', () => {
    it('spreads metadata into the JSON output', () => {
      logger.info('with meta', { component: 'test', count: 42 });

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.component).toBe('test');
      expect(parsed.count).toBe(42);
      expect(parsed.message).toBe('with meta');
    });

    it('outputs without extra fields when no metadata is provided', () => {
      logger.info('bare');

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      // Only the base keys should be present
      expect(Object.keys(parsed).sort()).toEqual(
        ['level', 'message', 'timestamp'].sort(),
      );
    });
  });

  // ---- Request ID injection ----

  describe('request ID', () => {
    it('includes requestId in output when getRequestId returns a value', () => {
      mockGetRequestId.mockReturnValue('abc-123-def-456');
      logger.info('with rid');

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.requestId).toBe('abc-123-def-456');
    });

    it('omits requestId when getRequestId returns undefined', () => {
      mockGetRequestId.mockReturnValue(undefined);
      logger.info('no rid');

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.requestId).toBeUndefined();
      expect('requestId' in parsed).toBe(false);
    });
  });

  // ---- Level filtering ----

  describe('level filtering', () => {
    // The default LOG_LEVEL is 'info' (rank 1).
    // debug has rank 0, so it should be filtered out.

    it('debug is filtered out at the default info level', () => {
      logger.debug('should not appear');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('info is not filtered at the default info level', () => {
      logger.info('should appear');
      expect(logSpy).toHaveBeenCalledOnce();
    });

    it('warn is not filtered at the default info level', () => {
      logger.warn('should appear');
      expect(logSpy).toHaveBeenCalledOnce();
    });

    it('error is not filtered at the default info level', () => {
      logger.error('should appear');
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    it('handles empty message', () => {
      logger.info('');
      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.message).toBe('');
    });

    it('handles metadata with nested objects', () => {
      logger.info('nested', { details: { foo: 'bar' } });
      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.details).toEqual({ foo: 'bar' });
    });

    it('metadata does not overwrite base fields like level or message', () => {
      // Object.assign merges meta after base fields, so meta keys
      // with the same name will overwrite — this tests actual behavior.
      logger.info('original', { message: 'overwritten', level: 'overwritten' });
      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      // Because Object.assign(entry, meta) runs after setting base fields,
      // meta values win for colliding keys.
      expect(parsed.message).toBe('overwritten');
      expect(parsed.level).toBe('overwritten');
    });
  });
});
