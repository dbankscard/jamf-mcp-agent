import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConverseCommand = vi.fn();
const mockBedrockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    constructor() {}
    send = mockBedrockSend;
  },
  ConverseCommand: class {
    constructor(params: any) {
      mockConverseCommand(params);
    }
  },
}));

vi.mock('./config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { preflight, logStartupBanner, loadConfigWithRetry, type PreflightDeps } from './preflight.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import type { Config } from './config.js';

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    healthPort: 8080,
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
      maxTokens: 8192,
      requestTimeoutMs: 120000,
    },
    slack: {
      enabled: false,
      channels: { compliance: 'C-COMP', security: 'C-SEC', fleet: 'C-FLEET' },
    },
    scheduler: {
      enabled: false,
      timezone: 'America/New_York',
      cron: { compliance: '0 8 * * 1-5', security: '0 9 * * 1-5', fleet: '0 10 * * 1' },
      maxRetries: 2,
      retryBackoffMs: 30000,
      jobTimeoutMs: 600000,
    },
    ...overrides,
  } as Config;
}

function makeMCP(connected = true, toolCount = 50) {
  return {
    isConnected: vi.fn(() => connected),
    getToolCount: vi.fn(() => toolCount),
  } as any;
}

function makeSlack(authError?: Error) {
  return {
    testAuth: authError ? vi.fn().mockRejectedValue(authError) : vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBedrockSend.mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } } });
  });

  it('passes when all checks succeed', async () => {
    const deps: PreflightDeps = {
      mcp: makeMCP(),
      slack: makeSlack(),
      config: makeConfig(),
    };

    await expect(preflight(deps)).resolves.toBeUndefined();
  });

  it('fails when MCP is not connected', async () => {
    const deps: PreflightDeps = {
      mcp: makeMCP(false),
      slack: null,
      config: makeConfig(),
    };

    await expect(preflight(deps)).rejects.toThrow('MCP: not connected');
  });

  it('fails when MCP has no tools', async () => {
    const deps: PreflightDeps = {
      mcp: makeMCP(true, 0),
      slack: null,
      config: makeConfig(),
    };

    await expect(preflight(deps)).rejects.toThrow('MCP: connected but no tools discovered');
  });

  it('fails when Slack auth test fails', async () => {
    const deps: PreflightDeps = {
      mcp: makeMCP(),
      slack: makeSlack(new Error('invalid_auth')),
      config: makeConfig(),
    };

    await expect(preflight(deps)).rejects.toThrow('Slack: invalid_auth');
  });

  it('fails when Bedrock check fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('model not found'));

    const deps: PreflightDeps = {
      mcp: makeMCP(),
      slack: null,
      config: makeConfig(),
    };

    await expect(preflight(deps)).rejects.toThrow('Bedrock: model not found');
  });

  it('passes through when slack is null', async () => {
    const deps: PreflightDeps = {
      mcp: makeMCP(),
      slack: null,
      config: makeConfig(),
    };

    await expect(preflight(deps)).resolves.toBeUndefined();
  });

  it('collects all failures before throwing', async () => {
    mockBedrockSend.mockRejectedValue(new Error('bedrock down'));

    const deps: PreflightDeps = {
      mcp: makeMCP(false),
      slack: makeSlack(new Error('slack down')),
      config: makeConfig(),
    };

    try {
      await preflight(deps);
      expect.fail('Expected error');
    } catch (err: any) {
      expect(err.message).toContain('MCP: not connected');
      expect(err.message).toContain('Slack: slack down');
      expect(err.message).toContain('Bedrock: bedrock down');
    }
  });
});

describe('logStartupBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs transport, model, and health port', () => {
    logStartupBanner(makeConfig());

    const calls = (logger.info as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('Transport: http');
    expect(calls.some((c: string) => c.includes('claude'))).toBe(true);
    expect(calls).toContain('Health port: 8080');
  });

  it('logs scheduler cron details when enabled', () => {
    logStartupBanner(makeConfig({
      scheduler: {
        enabled: true,
        timezone: 'UTC',
        cron: { compliance: '0 8 * * *', security: '0 9 * * *', fleet: '0 10 * * 1' },
        maxRetries: 2,
        retryBackoffMs: 30000,
        jobTimeoutMs: 600000,
      },
    } as any));

    const calls = (logger.info as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('Scheduler: enabled');
    expect(calls.some((c: string) => c.includes('0 8 * * *'))).toBe(true);
  });
});

describe('loadConfigWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns config on first success', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig).mockResolvedValue(config);

    const result = await loadConfigWithRetry(3, 10);

    expect(result).toBe(config);
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(config);

    const result = await loadConfigWithRetry(3, 10);

    expect(result).toBe(config);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts exhausted', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('persistent'));

    await expect(loadConfigWithRetry(2, 10)).rejects.toThrow('persistent');
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });
});
