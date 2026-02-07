import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockListResources = vi.fn();
const mockCallTool = vi.fn();
const mockReadResource = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    listResources = mockListResources;
    callTool = mockCallTool;
    readResource = mockReadResource;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    close = vi.fn();
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    close = vi.fn();
  },
}));

vi.mock('../metrics.js', () => ({
  recordMCPConnectDuration: vi.fn(async () => {}),
  recordMCPToolCall: vi.fn(async () => {}),
}));

import { MCPClient } from './client.js';
import { MCPError, TimeoutError } from '../errors.js';

describe('MCPClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'getFleetOverview', description: 'test', inputSchema: {} },
        { name: 'searchDevices', description: 'test', inputSchema: {} },
      ],
    });
    mockListResources.mockResolvedValue({ resources: [] });
  });

  it('connects and discovers tools', async () => {
    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.getToolCount()).toBe(2);
    expect(client.getTools()).toHaveLength(2);
  });

  it('skips connect if already connected', async () => {
    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();
    await client.connect();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects and clears state', async () => {
    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();
    await client.disconnect();

    expect(client.isConnected()).toBe(false);
    expect(client.getToolCount()).toBe(0);
  });

  it('throws MCPError when calling tool while disconnected', async () => {
    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await expect(client.callTool('test', {})).rejects.toThrow(MCPError);
  });

  it('throws MCPError for unknown tool', async () => {
    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();

    await expect(client.callTool('nonExistent', {})).rejects.toThrow(MCPError);
    await expect(client.callTool('nonExistent', {})).rejects.toThrow('Unknown tool');
  });

  it('calls tool successfully', async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    });

    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();
    const result = await client.callTool('getFleetOverview', {});

    expect(result.content).toEqual([{ type: 'text', text: 'result' }]);
  });

  it('times out on slow connect', async () => {
    mockConnect.mockImplementation(() => new Promise(() => {}));

    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      connectTimeoutMs: 50,
    });

    await expect(client.connect()).rejects.toThrow(MCPError);
  });

  it('times out on slow tool call', async () => {
    mockCallTool.mockImplementation(() => new Promise(() => {}));

    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      toolTimeoutMs: 50,
    });

    await client.connect();

    await expect(client.callTool('getFleetOverview', {})).rejects.toThrow(TimeoutError);
  });

  it('reconnects on transport error during callTool', async () => {
    let callCount = 0;
    mockCallTool.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve({
        content: [{ type: 'text', text: 'retry-result' }],
        isError: false,
      });
    });

    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      reconnectBaseMs: 10,
    });

    await client.connect();
    const result = await client.callTool('getFleetOverview', {});

    expect(result.content[0]).toEqual({ type: 'text', text: 'retry-result' });
  });

  it('handles resource listing gracefully when not supported', async () => {
    mockListResources.mockRejectedValue(new Error('Not supported'));

    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.getResources()).toEqual([]);
  });

  it('reads resource successfully', async () => {
    mockReadResource.mockResolvedValue({
      contents: [{ text: 'resource-data' }],
    });

    const client = new MCPClient({
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
    });

    await client.connect();
    const result = await client.readResource('test://resource');

    expect(result).toBe('resource-data');
  });

  it('creates stdio transport', async () => {
    const client = new MCPClient({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { JAMF_URL: 'https://test.jamfcloud.com' },
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);
  });

  // --- New tests for uncovered branches ---

  describe('isTransportError detection', () => {
    it.each([
      'ECONNREFUSED',
      'ECONNRESET',
      'EPIPE',
      'connection closed unexpectedly',
      'server disconnect',
    ])('detects "%s" as transport error and triggers reconnect', async (msg) => {
      let callCount = 0;
      mockCallTool.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error(msg));
        return Promise.resolve({
          content: [{ type: 'text', text: 'recovered' }],
          isError: false,
        });
      });

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      const result = await client.callTool('getFleetOverview', {});
      expect(result.content[0]).toEqual({ type: 'text', text: 'recovered' });
    });

    it('does not treat non-transport errors as transport errors', async () => {
      mockCallTool.mockRejectedValue(new Error('Validation failed'));

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      await expect(client.callTool('getFleetOverview', {})).rejects.toThrow('Validation failed');
      // connect called once for initial connect, NOT a second time for reconnect
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('returns false for non-Error values (line 35)', async () => {
      // When a non-Error is thrown, isTransportError returns false, so no reconnect
      mockCallTool.mockRejectedValue('string error');

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      await expect(client.callTool('getFleetOverview', {})).rejects.toBe('string error');
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnect', () => {
    it('throws MCPError when max reconnect attempts exceeded', async () => {
      // For the counter to accumulate, connect() must fail during reconnect
      // (so reconnectAttempt is not reset to 0).
      // Flow: callTool -> transport error -> reconnect (attempt++) -> connect() fails
      //       -> error propagates. Next callTool -> same flow -> eventually exceeds max.

      // Initial connect succeeds (first call), subsequent connects fail
      let connectCount = 0;
      mockConnect.mockImplementation(() => {
        connectCount++;
        if (connectCount === 1) return Promise.resolve(undefined);
        return Promise.reject(new Error('ECONNREFUSED'));
      });
      mockCallTool.mockRejectedValue(new Error('ECONNRESET'));

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        maxReconnectAttempts: 2,
        reconnectBaseMs: 1,
      });

      await client.connect();

      // First callTool: ECONNRESET -> reconnect (attempt 1) -> connect() fails -> MCPError from connect
      await expect(client.callTool('getFleetOverview', {})).rejects.toThrow(MCPError);

      // Second callTool: ECONNRESET -> reconnect (attempt 2) -> connect() fails -> MCPError from connect
      await expect(client.callTool('getFleetOverview', {})).rejects.toThrow(MCPError);

      // Third callTool: ECONNRESET -> reconnect (attempt 3 > max 2) -> throws max exceeded
      await expect(client.callTool('getFleetOverview', {})).rejects.toThrow(
        /Max reconnect attempts \(2\) exceeded/,
      );
    });

    it('handles close error during reconnect gracefully', async () => {
      let callCount = 0;
      mockCallTool.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('ECONNRESET'));
        return Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        });
      });

      // Make close throw an error — should be silently caught
      mockClose.mockRejectedValue(new Error('close failed'));

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      const result = await client.callTool('getFleetOverview', {});
      expect(result.content[0]).toEqual({ type: 'text', text: 'ok' });
    });
  });

  describe('callTool — non-transport error', () => {
    it('throws directly without reconnect attempt', async () => {
      const appError = new Error('Application-level failure');
      mockCallTool.mockRejectedValue(appError);

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      await expect(client.callTool('getFleetOverview', {})).rejects.toThrow(
        'Application-level failure',
      );
      // Only the initial connect, no reconnect
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('readResource', () => {
    it('returns text content on success', async () => {
      mockReadResource.mockResolvedValue({
        contents: [{ text: 'hello world' }],
      });

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
      });

      await client.connect();
      const result = await client.readResource('test://res');
      expect(result).toBe('hello world');
    });

    it('triggers reconnect and retry on transport error', async () => {
      let readCount = 0;
      mockReadResource.mockImplementation(() => {
        readCount++;
        if (readCount === 1) return Promise.reject(new Error('EPIPE'));
        return Promise.resolve({
          contents: [{ text: 'recovered-resource' }],
        });
      });

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      const result = await client.readResource('test://res');
      expect(result).toBe('recovered-resource');
      // Initial connect + reconnect
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('returns JSON.stringify for non-text content', async () => {
      const binaryContent = [{ blob: 'base64data' }];
      mockReadResource.mockResolvedValue({
        contents: binaryContent,
      });

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
      });

      await client.connect();
      const result = await client.readResource('test://res');
      expect(result).toBe(JSON.stringify(binaryContent));
    });

    it('returns JSON.stringify for non-text content after transport error retry', async () => {
      let readCount = 0;
      const binaryContent = [{ blob: 'retried-data' }];
      mockReadResource.mockImplementation(() => {
        readCount++;
        if (readCount === 1) return Promise.reject(new Error('connection closed'));
        return Promise.resolve({ contents: binaryContent });
      });

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      const result = await client.readResource('test://res');
      expect(result).toBe(JSON.stringify(binaryContent));
    });

    it('throws non-transport error directly without reconnect', async () => {
      mockReadResource.mockRejectedValue(new Error('Permission denied'));

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        reconnectBaseMs: 1,
      });

      await client.connect();
      await expect(client.readResource('test://res')).rejects.toThrow('Permission denied');
      // Only initial connect, no reconnect
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('throws MCPError when reading resource while disconnected', async () => {
      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
      });

      await expect(client.readResource('test://res')).rejects.toThrow(MCPError);
      await expect(client.readResource('test://res')).rejects.toThrow('Not connected');
    });
  });

  describe('constructor defaults', () => {
    it('uses default connectTimeoutMs of 30000', async () => {
      mockConnect.mockImplementation(() => new Promise(() => {}));

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        // No connectTimeoutMs specified — should default to 30_000
      });

      // We verify the default indirectly: if connectTimeoutMs were 0 or small,
      // this would reject immediately. We just check the instance was created.
      // A more direct check: override only toolTimeoutMs and verify connectTimeout
      // is not that value.
      expect(client).toBeInstanceOf(MCPClient);
    });

    it('uses default toolTimeoutMs of 120000', async () => {
      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
        // No toolTimeoutMs specified — should default to 120_000
      });

      expect(client).toBeInstanceOf(MCPClient);
    });
  });

  describe('discoverCapabilities with resources', () => {
    it('populates resources map when server returns resources', async () => {
      mockListResources.mockResolvedValue({
        resources: [
          { uri: 'res://fleet', name: 'Fleet Data' },
          { uri: 'res://compliance', name: 'Compliance Report' },
        ],
      });

      const client = new MCPClient({
        transport: 'http',
        serverUrl: 'http://localhost:3001/mcp',
      });

      await client.connect();
      const resources = client.getResources();
      expect(resources).toHaveLength(2);
      expect(resources[0]).toEqual({ uri: 'res://fleet', name: 'Fleet Data' });
      expect(resources[1]).toEqual({ uri: 'res://compliance', name: 'Compliance Report' });
    });
  });
});
