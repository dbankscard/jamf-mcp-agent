import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./scheduler/index.js', () => ({
  getRunningJobs: vi.fn(() => []),
}));

import { createHealthServer } from './health-server.js';
import { HealthChecker, type HealthStatus } from './health.js';
import type { Config } from './config.js';

function makeConfig(): Config {
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
      model: 'test-model',
      maxToolRounds: 15,
      maxTokens: 8192,
      requestTimeoutMs: 120000,
    },
    slack: {
      enabled: false,
      channels: {},
    },
    scheduler: {
      enabled: false,
      timezone: 'UTC',
      cron: { compliance: '0 8 * * *', security: '0 9 * * *', fleet: '0 10 * * 1' },
      maxRetries: 2,
      retryBackoffMs: 30000,
      jobTimeoutMs: 600000,
    },
  } as Config;
}

function makeMCP(connected = true, toolCount = 50) {
  return {
    isConnected: vi.fn(() => connected),
    getToolCount: vi.fn(() => toolCount),
  } as any;
}

function fetch(server: http.Server, path: string, method = 'GET'): Promise<{ statusCode: number; body: any }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode!, body: JSON.parse(data) });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('health-server', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /health returns 200 when healthy', async () => {
    const checker = new HealthChecker(makeMCP(), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/health');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('GET /health returns 503 when unhealthy', async () => {
    const checker = new HealthChecker(makeMCP(false), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/health');

    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('GET /health returns 200 when degraded', async () => {
    const checker = new HealthChecker(makeMCP(true, 0), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/health');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  it('GET /ready returns 200 when MCP healthy', async () => {
    const checker = new HealthChecker(makeMCP(), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/ready');

    expect(res.statusCode).toBe(200);
  });

  it('GET /ready returns 503 when MCP unhealthy', async () => {
    const checker = new HealthChecker(makeMCP(false), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/ready');

    expect(res.statusCode).toBe(503);
  });

  it('returns 404 for unknown paths', async () => {
    const checker = new HealthChecker(makeMCP(), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/unknown');

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('returns 405 for non-GET methods', async () => {
    const checker = new HealthChecker(makeMCP(), makeConfig());
    server = createHealthServer(checker, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));

    const res = await fetch(server, '/health', 'POST');

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toBe('Method not allowed');
  });
});
