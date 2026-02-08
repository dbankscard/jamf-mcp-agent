import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';

export interface BedrockTool {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: unknown };
  };
}

const READ_ONLY_PATTERN = /^(search|list|get|check|read)/;

const ALWAYS_INCLUDE = new Set([
  'getFleetOverview',
  'getSecurityPosture',
  'getPolicyAnalysis',
  'getDeviceFullProfile',
  'getDevicesBatch',
  'getInventorySummary',
  'checkDeviceCompliance',
  'getDeviceComplianceSummary',
  // Read-only compound skills (write skills like skill_batch_inventory_update
  // and skill_deploy_policy_by_criteria are intentionally excluded)
  'skill_device_search',
  'skill_find_outdated_devices',
  'skill_scheduled_compliance_check',
]);

/**
 * Convert MCP tools to Bedrock Converse tool definitions.
 * By default only read-only tools are included (safe for scheduled reports).
 */
export function mapTools(mcpTools: MCPTool[], readOnlyOnly = true): BedrockTool[] {
  const filtered = readOnlyOnly
    ? mcpTools.filter(t => READ_ONLY_PATTERN.test(t.name) || ALWAYS_INCLUDE.has(t.name))
    : mcpTools;

  return filtered.map(t => ({
    toolSpec: {
      name: t.name,
      description: t.description ?? '',
      inputSchema: { json: t.inputSchema ?? { type: 'object', properties: {} } },
    },
  }));
}
