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
});
