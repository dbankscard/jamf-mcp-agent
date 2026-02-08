import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock secrets before importing config
vi.mock('./secrets.js', () => ({
  fetchSecrets: vi.fn(),
}));

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses stdio mode with all required fields', async () => {
    process.env.MCP_TRANSPORT = 'stdio';
    process.env.MCP_SERVER_PATH = '/path/to/server.js';
    process.env.JAMF_URL = 'https://test.jamfcloud.com';
    process.env.JAMF_CLIENT_ID = 'client-id';
    process.env.JAMF_CLIENT_SECRET = 'client-secret';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.mcp.transport).toBe('stdio');
    expect(config.mcp.serverPath).toBe('/path/to/server.js');
    expect(config.mcp.jamfUrl).toBe('https://test.jamfcloud.com');
  });

  it('parses http mode with server URL', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.mcp.transport).toBe('http');
    expect(config.mcp.serverUrl).toBe('http://localhost:3001/mcp');
  });

  it('applies default timeout values', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.mcp.connectTimeoutMs).toBe(30_000);
    expect(config.mcp.toolTimeoutMs).toBe(120_000);
    expect(config.mcp.maxReconnectAttempts).toBe(5);
    expect(config.mcp.reconnectBaseMs).toBe(1_000);
    expect(config.bedrock.requestTimeoutMs).toBe(120_000);
  });

  it('throws ConfigError on missing required fields', async () => {
    process.env.MCP_TRANSPORT = 'stdio';
    // Missing MCP_SERVER_PATH, JAMF_URL, etc.

    const { loadConfig } = await import('./config.js');
    const { ConfigError } = await import('./errors.js');

    await expect(loadConfig()).rejects.toThrow(ConfigError);
  });

  it('applies bedrock defaults', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.bedrock.region).toBe('us-east-1');
    expect(config.bedrock.model).toContain('claude');
    expect(config.bedrock.maxToolRounds).toBe(15);
    expect(config.bedrock.maxTokens).toBe(8192);
  });

  it('applies scheduler defaults', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.scheduler.maxRetries).toBe(2);
    expect(config.scheduler.retryBackoffMs).toBe(30_000);
  });

  it('reads BEDROCK_MAX_TOKENS from env', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';
    process.env.BEDROCK_MAX_TOKENS = '4096';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.bedrock.maxTokens).toBe(4096);
  });

  it('reads custom timeout values from env', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';
    process.env.MCP_CONNECT_TIMEOUT_MS = '5000';
    process.env.BEDROCK_REQUEST_TIMEOUT_MS = '60000';

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.mcp.connectTimeoutMs).toBe(5000);
    expect(config.bedrock.requestTimeoutMs).toBe(60000);
  });

  it('merges secrets over env vars when AWS_SECRET_NAME is set', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';
    process.env.AWS_SECRET_NAME = 'test-secret';
    process.env.SLACK_BOT_TOKEN = 'env-token';

    const { fetchSecrets } = await import('./secrets.js');
    vi.mocked(fetchSecrets).mockResolvedValue({
      SLACK_BOT_TOKEN: 'secret-token',
      SLACK_ENABLED: 'true',
    });

    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();

    expect(config.slack.botToken).toBe('secret-token');
    expect(config.slack.enabled).toBe(true);
  });
});

describe('loadConfigSync', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('works without secrets support', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_SERVER_URL = 'http://localhost:3001/mcp';

    const { loadConfigSync } = await import('./config.js');
    const config = loadConfigSync();

    expect(config.mcp.transport).toBe('http');
    expect(config.mcp.serverUrl).toBe('http://localhost:3001/mcp');
    // Verify defaults are applied
    expect(config.bedrock.region).toBe('us-east-1');
    expect(config.scheduler.enabled).toBe(false);
  });

  it('throws ConfigError on invalid config', async () => {
    // stdio mode without required fields
    process.env.MCP_TRANSPORT = 'stdio';
    // Deliberately omit MCP_SERVER_PATH, JAMF_URL, etc.

    const { loadConfigSync } = await import('./config.js');
    const { ConfigError } = await import('./errors.js');

    expect(() => loadConfigSync()).toThrow(ConfigError);
  });
});

describe('HTTP mode validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws validation error when MCP_SERVER_URL is missing in http mode', async () => {
    process.env.MCP_TRANSPORT = 'http';
    // Deliberately omit MCP_SERVER_URL

    const { loadConfig } = await import('./config.js');
    const { ConfigError } = await import('./errors.js');

    await expect(loadConfig()).rejects.toThrow(ConfigError);
  });
});
