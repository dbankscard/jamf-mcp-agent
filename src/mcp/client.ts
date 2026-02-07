import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Tool, Resource, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { logger } from '../logger.js';
import { MCPError } from '../errors.js';
import { withTimeout } from '../utils.js';
import { recordMCPConnectDuration, recordMCPToolCall } from '../metrics.js';

export type MCPConnectionOptions =
  | {
      transport: 'stdio';
      command: string;
      args: string[];
      env?: Record<string, string>;
      connectTimeoutMs?: number;
      toolTimeoutMs?: number;
      maxReconnectAttempts?: number;
      reconnectBaseMs?: number;
    }
  | {
      transport: 'http';
      serverUrl: string;
      connectTimeoutMs?: number;
      toolTimeoutMs?: number;
      maxReconnectAttempts?: number;
      reconnectBaseMs?: number;
    };

const TRANSPORT_ERROR_PATTERN = /ECONNREFUSED|ECONNRESET|EPIPE|closed|disconnect/i;

function isTransportError(err: unknown): boolean {
  if (err instanceof Error) return TRANSPORT_ERROR_PATTERN.test(err.message);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class MCPClient {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private tools: Map<string, Tool> = new Map();
  private resources: Map<string, Resource> = new Map();
  private connected = false;
  private reconnectAttempt = 0;

  private readonly connectTimeoutMs: number;
  private readonly toolTimeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseMs: number;

  constructor(private options: MCPConnectionOptions) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 120_000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const transport = this.createTransport();
    this.transport = transport;

    this.client = new Client(
      { name: 'jamf-mcp-agent', version: '0.1.0' },
      { capabilities: {} },
    );

    const start = Date.now();
    try {
      await withTimeout(
        this.client.connect(transport),
        this.connectTimeoutMs,
        'mcp.connect',
        'mcp',
      );
    } catch (err) {
      throw err instanceof MCPError
        ? err
        : new MCPError('Failed to connect to MCP server', {
            operation: 'connect',
            cause: err instanceof Error ? err : new Error(String(err)),
          });
    }
    recordMCPConnectDuration(Date.now() - start).catch(() => {});

    this.connected = true;
    this.reconnectAttempt = 0;
    logger.info('Connected to MCP server');

    await this.discoverCapabilities();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.connected = false;
    this.tools.clear();
    this.resources.clear();
    logger.info('Disconnected from MCP server');
  }

  isConnected(): boolean {
    return this.connected;
  }

  getToolCount(): number {
    return this.tools.size;
  }

  private createTransport(): Transport {
    if (this.options.transport === 'stdio') {
      logger.info('Starting MCP server subprocess...');
      return new StdioClientTransport({
        command: this.options.command,
        args: this.options.args,
        env: { ...process.env, ...this.options.env } as Record<string, string>,
      });
    } else {
      logger.info(`Connecting to MCP server at ${this.options.serverUrl}...`);
      return new StreamableHTTPClientTransport(
        new URL(this.options.serverUrl),
      );
    }
  }

  private async reconnect(): Promise<void> {
    this.reconnectAttempt++;

    if (this.reconnectAttempt > this.maxReconnectAttempts) {
      throw new MCPError(
        `Max reconnect attempts (${this.maxReconnectAttempts}) exceeded`,
        { operation: 'reconnect', context: { attempts: this.reconnectAttempt } },
      );
    }

    const delay = this.reconnectBaseMs * 2 ** (this.reconnectAttempt - 1);
    logger.warn(
      `MCP reconnect attempt ${this.reconnectAttempt}/${this.maxReconnectAttempts} in ${delay}ms...`,
    );
    await sleep(delay);

    // Tear down old connection
    try {
      if (this.client) await this.client.close();
    } catch { /* ignore close errors */ }
    try {
      if (this.transport) await this.transport.close();
    } catch { /* ignore close errors */ }

    this.client = null;
    this.transport = null;
    this.connected = false;

    await this.connect();
  }

  private async discoverCapabilities(): Promise<void> {
    if (!this.client) throw new MCPError('Not connected', { operation: 'discoverCapabilities' });

    const toolsResult = await this.client.listTools();
    this.tools.clear();
    for (const tool of toolsResult.tools) {
      this.tools.set(tool.name, tool);
    }
    logger.info(`Discovered ${this.tools.size} tools`);

    try {
      const resourcesResult = await this.client.listResources();
      this.resources.clear();
      for (const resource of resourcesResult.resources) {
        this.resources.set(resource.uri, resource);
      }
      logger.info(`Discovered ${this.resources.size} resources`);
    } catch {
      logger.warn('Server does not support resources — skipping');
    }
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getResources(): Resource[] {
    return Array.from(this.resources.values());
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new MCPError('Not connected', { operation: 'callTool', context: { tool: name } });
    if (!this.tools.has(name)) throw new MCPError(`Unknown tool: ${name}`, { operation: 'callTool', context: { tool: name } });

    logger.debug(`Calling tool: ${name}`, { args });

    const start = Date.now();
    try {
      const result = await withTimeout(
        this.client.callTool({ name, arguments: args }),
        this.toolTimeoutMs,
        'mcp.callTool',
        'mcp',
      );
      recordMCPToolCall(name, Date.now() - start, false).catch(() => {});
      return result as CallToolResult;
    } catch (err) {
      if (isTransportError(err)) {
        logger.warn(`Transport error on callTool(${name}), attempting reconnect...`);
        await this.reconnect();
        // Retry once after reconnect
        if (!this.client) throw new MCPError('Not connected after reconnect', { operation: 'callTool', context: { tool: name } });
        const retryStart = Date.now();
        const result = await withTimeout(
          this.client.callTool({ name, arguments: args }),
          this.toolTimeoutMs,
          'mcp.callTool',
          'mcp',
        );
        recordMCPToolCall(name, Date.now() - retryStart, false).catch(() => {});
        return result as CallToolResult;
      }
      recordMCPToolCall(name, Date.now() - start, true).catch(() => {});
      throw err;
    }
  }

  async readResource(uri: string): Promise<string> {
    if (!this.client) throw new MCPError('Not connected', { operation: 'readResource', context: { uri } });

    try {
      const result = await withTimeout(
        this.client.readResource({ uri }),
        this.toolTimeoutMs,
        'mcp.readResource',
        'mcp',
      );
      const content = result.contents[0];
      if (content && 'text' in content) return content.text as string;
      return JSON.stringify(result.contents);
    } catch (err) {
      if (isTransportError(err)) {
        logger.warn(`Transport error on readResource(${uri}), attempting reconnect...`);
        await this.reconnect();
        if (!this.client) throw new MCPError('Not connected after reconnect', { operation: 'readResource', context: { uri } });
        const result = await withTimeout(
          this.client.readResource({ uri }),
          this.toolTimeoutMs,
          'mcp.readResource',
          'mcp',
        );
        const content = result.contents[0];
        if (content && 'text' in content) return content.text as string;
        return JSON.stringify(result.contents);
      }
      throw err;
    }
  }
}
