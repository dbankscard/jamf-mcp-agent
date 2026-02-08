import type { Config } from '../config.js';
import type { MCPConnectionOptions } from './client.js';

/**
 * Build MCP connection options from config.
 * Shared between src/index.ts and src/cli/index.ts to avoid duplication.
 */
export function buildMCPOptions(config: Config): MCPConnectionOptions {
  if (config.mcp.transport === 'http') {
    return {
      transport: 'http',
      serverUrl: config.mcp.serverUrl!,
      connectTimeoutMs: config.mcp.connectTimeoutMs,
      toolTimeoutMs: config.mcp.toolTimeoutMs,
      maxReconnectAttempts: config.mcp.maxReconnectAttempts,
      reconnectBaseMs: config.mcp.reconnectBaseMs,
    };
  }

  return {
    transport: 'stdio',
    command: 'node',
    args: [config.mcp.serverPath!],
    env: {
      JAMF_URL: config.mcp.jamfUrl!,
      JAMF_CLIENT_ID: config.mcp.jamfClientId!,
      JAMF_CLIENT_SECRET: config.mcp.jamfClientSecret!,
    },
    connectTimeoutMs: config.mcp.connectTimeoutMs,
    toolTimeoutMs: config.mcp.toolTimeoutMs,
    maxReconnectAttempts: config.mcp.maxReconnectAttempts,
    reconnectBaseMs: config.mcp.reconnectBaseMs,
  };
}
