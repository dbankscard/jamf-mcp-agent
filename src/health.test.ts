import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock scheduler before importing health
vi.mock('./scheduler/index.js', () => ({
  getRunningJobs: vi.fn(() => []),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { HealthChecker, type HealthStatus } from './health.js';
import { getRunningJobs } from './scheduler/index.js';
import type { Config } from './config.js';

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    mcp: {
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      connectTimeoutMs: 30000,
      toolTimeoutMs: 120000,
      maxReconnectAttempts: 5,
      reconnectBaseMs: 1000,
    },
    bedrock: {
      region: 'us-east-1',
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      maxToolRounds: 15,
      requestTimeoutMs: 120000,
    },
    slack: {
      enabled: false,
      channels: {},
    },
    scheduler: {
      enabled: false,
      timezone: 'America/New_York',
      cron: { compliance: '0 8 * * 1-5', security: '0 9 * * 1-5', fleet: '0 10 * * 1' },
    },
    ...overrides,
  } as Config;
}

function makeMCP(connected: boolean, toolCount: number) {
  return {
    isConnected: () => connected,
    getToolCount: () => toolCount,
  } as any;
}

describe('HealthChecker', () => {
  beforeEach(() => {
    vi.mocked(getRunningJobs).mockReturnValue([]);
  });

  it('reports healthy when all components are good', async () => {
    const checker = new HealthChecker(makeMCP(true, 50), makeConfig());
    const status = await checker.getHealthStatus();

    expect(status.status).toBe('healthy');
    expect(status.components.mcp.status).toBe('healthy');
    expect(status.components.bedrock.status).toBe('healthy');
    expect(status.components.slack.status).toBe('healthy');
    expect(status.components.scheduler.status).toBe('healthy');
  });

  it('reports unhealthy when MCP is not connected', async () => {
    const checker = new HealthChecker(makeMCP(false, 0), makeConfig());
    const status = await checker.getHealthStatus();

    expect(status.status).toBe('unhealthy');
    expect(status.components.mcp.status).toBe('unhealthy');
  });

  it('reports unhealthy when MCP is null', async () => {
    const checker = new HealthChecker(null, makeConfig());
    const status = await checker.getHealthStatus();

    expect(status.status).toBe('unhealthy');
    expect(status.components.mcp.status).toBe('unhealthy');
  });

  it('reports degraded when MCP connected but no tools', async () => {
    const checker = new HealthChecker(makeMCP(true, 0), makeConfig());
    const status = await checker.getHealthStatus();

    expect(status.status).toBe('degraded');
    expect(status.components.mcp.status).toBe('degraded');
  });

  it('reports slack healthy when disabled', async () => {
    const checker = new HealthChecker(makeMCP(true, 50), makeConfig({ slack: { enabled: false, channels: {} } } as any));
    const status = await checker.getHealthStatus();

    expect(status.components.slack.status).toBe('healthy');
    expect(status.components.slack.message).toBe('Slack disabled');
  });

  it('reports slack degraded when enabled but no token', async () => {
    const checker = new HealthChecker(
      makeMCP(true, 50),
      makeConfig({ slack: { enabled: true, channels: {} } } as any),
    );
    const status = await checker.getHealthStatus();

    expect(status.components.slack.status).toBe('degraded');
  });

  it('reports slack healthy when enabled with token', async () => {
    const checker = new HealthChecker(
      makeMCP(true, 50),
      makeConfig({ slack: { enabled: true, botToken: 'xoxb-test', channels: {} } } as any),
    );
    const status = await checker.getHealthStatus();

    expect(status.components.slack.status).toBe('healthy');
  });

  it('reports scheduler with running jobs', async () => {
    vi.mocked(getRunningJobs).mockReturnValue(['compliance' as any]);
    const checker = new HealthChecker(
      makeMCP(true, 50),
      makeConfig({ scheduler: { enabled: true, timezone: 'UTC', cron: { compliance: '', security: '', fleet: '' } } } as any),
    );
    const status = await checker.getHealthStatus();

    expect(status.components.scheduler.message).toContain('compliance');
  });

  it('includes timestamp', async () => {
    const checker = new HealthChecker(makeMCP(true, 50), makeConfig());
    const status = await checker.getHealthStatus();
    expect(status.timestamp).toBeDefined();
    expect(() => new Date(status.timestamp)).not.toThrow();
  });
});

describe('startPeriodicCheck', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a stop function that clears the interval', () => {
    vi.useFakeTimers();
    const checker = new HealthChecker(makeMCP(true, 50), makeConfig());
    const stop = checker.startPeriodicCheck(1000);
    expect(typeof stop).toBe('function');
    stop();
  });

  it('logs warning when health degrades', async () => {
    vi.useFakeTimers();
    const { logger } = await import('./logger.js');

    const checker = new HealthChecker(null, makeConfig());
    const stop = checker.startPeriodicCheck(1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Health unhealthy'),
    );
    stop();
  });
});
