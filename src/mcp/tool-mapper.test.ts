import { describe, it, expect } from 'vitest';
import { mapTools } from './tool-mapper.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

function makeTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

describe('mapTools', () => {
  const allTools: Tool[] = [
    makeTool('getFleetOverview'),
    makeTool('searchDevices'),
    makeTool('listPolicies'),
    makeTool('createPolicy'),
    makeTool('deleteScript'),
    makeTool('checkDeviceCompliance'),
    makeTool('skill_batch_inventory_update'),
    makeTool('skill_deploy_policy_by_criteria'),
    makeTool('skill_device_search'),
    makeTool('skill_find_outdated_devices'),
    makeTool('skill_scheduled_compliance_check'),
    makeTool('readSomething'),
  ];

  it('filters to read-only tools by default', () => {
    const result = mapTools(allTools, true);
    const names = result.map(t => t.toolSpec.name);

    expect(names).toContain('getFleetOverview');
    expect(names).toContain('searchDevices');
    expect(names).toContain('listPolicies');
    expect(names).toContain('checkDeviceCompliance');
    expect(names).toContain('readSomething');
    // Read-only compound skills are included
    expect(names).toContain('skill_device_search');
    expect(names).toContain('skill_find_outdated_devices');
    expect(names).toContain('skill_scheduled_compliance_check');
    // Write compound skills are excluded in read-only mode
    expect(names).not.toContain('skill_batch_inventory_update');
    expect(names).not.toContain('skill_deploy_policy_by_criteria');
    expect(names).not.toContain('createPolicy');
    expect(names).not.toContain('deleteScript');
  });

  it('includes always-include tools even if they do not match pattern', () => {
    const tools: Tool[] = [makeTool('getDeviceFullProfile')];
    const result = mapTools(tools, true);
    expect(result).toHaveLength(1);
    expect(result[0].toolSpec.name).toBe('getDeviceFullProfile');
  });

  it('includes all tools including write compound skills when readOnlyOnly=false', () => {
    const result = mapTools(allTools, false);
    const names = result.map(t => t.toolSpec.name);
    expect(result).toHaveLength(allTools.length);
    expect(names).toContain('skill_batch_inventory_update');
    expect(names).toContain('skill_deploy_policy_by_criteria');
    expect(names).toContain('createPolicy');
    expect(names).toContain('deleteScript');
  });

  it('converts to Bedrock tool shape', () => {
    const result = mapTools([makeTool('searchDevices')]);
    expect(result[0]).toEqual({
      toolSpec: {
        name: 'searchDevices',
        description: 'searchDevices tool',
        inputSchema: { json: { type: 'object', properties: {} } },
      },
    });
  });

  it('handles empty tool list', () => {
    const result = mapTools([]);
    expect(result).toEqual([]);
  });

  it('handles missing description and inputSchema', () => {
    const tool: Tool = { name: 'testTool' } as any;
    const result = mapTools([tool], false);
    expect(result[0].toolSpec.description).toBe('');
    expect(result[0].toolSpec.inputSchema.json).toEqual({ type: 'object', properties: {} });
  });
});
