import { describe, it, expect } from 'vitest';
import { buildMCPOptions } from './options.js';
import type { Config } from '../config.js';

function makeConfig(overrides?: Partial<Config['mcp']>): Config {
  return {
    mcp: {
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      connectTimeoutMs: 30000,
      toolTimeoutMs: 120000,
      maxReconnectAttempts: 5,
      reconnectBaseMs: 1000,
      ...overrides,
    },
    bedrock: {
      region: 'us-east-1',
      model: 'test-model',
      maxToolRounds: 15,
      requestTimeoutMs: 120000,
    },
    slack: {
      enabled: false,
      channels: {},
    },
    scheduler: {
      enabled: false,
      timezone: 'UTC',
      cron: { compliance: '', security: '', fleet: '' },
    },
  } as Config;
}

describe('buildMCPOptions', () => {
  it('returns http options when transport is http', () => {
    const config = makeConfig({ transport: 'http', serverUrl: 'http://localhost:3001/mcp' });
    const options = buildMCPOptions(config);

    expect(options).toEqual({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      connectTimeoutMs: 30000,
      toolTimeoutMs: 120000,
      maxReconnectAttempts: 5,
      reconnectBaseMs: 1000,
    });
  });

  it('returns stdio options when transport is stdio', () => {
    const config = makeConfig({
      transport: 'stdio',
      serverPath: '/path/to/server.js',
      jamfUrl: 'https://jamf.example.com',
      jamfClientId: 'client-id',
      jamfClientSecret: 'client-secret',
    });
    const options = buildMCPOptions(config);

    expect(options).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['/path/to/server.js'],
      env: {
        JAMF_URL: 'https://jamf.example.com',
        JAMF_CLIENT_ID: 'client-id',
        JAMF_CLIENT_SECRET: 'client-secret',
      },
      connectTimeoutMs: 30000,
      toolTimeoutMs: 120000,
      maxReconnectAttempts: 5,
      reconnectBaseMs: 1000,
    });
  });

  it('passes through custom timeout values', () => {
    const config = makeConfig({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      connectTimeoutMs: 5000,
      toolTimeoutMs: 60000,
      maxReconnectAttempts: 3,
      reconnectBaseMs: 500,
    });
    const options = buildMCPOptions(config);

    expect(options.connectTimeoutMs).toBe(5000);
    expect(options.toolTimeoutMs).toBe(60000);
    expect(options.maxReconnectAttempts).toBe(3);
    expect(options.reconnectBaseMs).toBe(500);
  });
});
