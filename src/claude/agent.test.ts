import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = mockSend;
  },
  ConverseCommand: class {
    constructor(public input: any) {}
  },
}));

vi.mock('../metrics.js', () => ({
  recordAgentRun: vi.fn(async () => {}),
}));

vi.mock('../context.js', () => ({
  runWithContext: vi.fn((fn: () => any) => fn()),
  getRequestId: vi.fn(() => 'test-request-id'),
  getJobType: vi.fn(() => undefined),
}));

import { Agent } from './agent.js';

function makeMCPClient() {
  return {
    getTools: vi.fn(() => [
      { name: 'getFleetOverview', description: 'test', inputSchema: {} },
    ]),
    callTool: vi.fn(),
  } as any;
}

describe('Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes a single-round run with text response', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [{ text: '{"summary":"test","overallStatus":"healthy","findings":[],"metrics":{"total":5}}' }],
        },
      },
      stopReason: 'end_turn',
    });

    const mcp = makeMCPClient();
    const agent = new Agent(mcp, {
      model: 'test-model',
      maxToolRounds: 5,
      region: 'us-east-1',
    });

    const result = await agent.run('You are a test agent', 'Run a test');

    expect(result.report).not.toBeNull();
    expect(result.report?.overallStatus).toBe('healthy');
    expect(result.rounds).toBe(1);
    expect(result.toolCallCount).toBe(0);
  });

  it('handles multi-round with tool calls', async () => {
    mockSend
      .mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  toolUseId: 'tool-1',
                  name: 'getFleetOverview',
                  input: {},
                },
              },
            ],
          },
        },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        output: {
          message: {
            content: [{ text: '{"summary":"fleet is healthy","overallStatus":"healthy","findings":[],"metrics":{"total":10}}' }],
          },
        },
        stopReason: 'end_turn',
      });

    const mcp = makeMCPClient();
    mcp.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"totalDevices": 10}' }],
      isError: false,
    });

    const agent = new Agent(mcp, {
      model: 'test-model',
      maxToolRounds: 5,
      region: 'us-east-1',
    });

    const result = await agent.run('system', 'user');

    expect(result.rounds).toBe(2);
    expect(result.toolCallCount).toBe(1);
    expect(result.report?.overallStatus).toBe('healthy');
    expect(mcp.callTool).toHaveBeenCalledWith('getFleetOverview', {});
  });

  it('retries on rate limit errors', async () => {
    mockSend
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce({
        output: {
          message: { content: [{ text: 'plain text' }] },
        },
        stopReason: 'end_turn',
      });

    const mcp = makeMCPClient();
    const agent = new Agent(mcp, {
      model: 'test-model',
      maxToolRounds: 5,
      region: 'us-east-1',
    });

    const result = await agent.run('system', 'user');
    expect(result.rawText).toBe('plain text');
  });

  it('returns rawText when no structured report', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: { content: [{ text: 'Just some plain text response' }] },
      },
      stopReason: 'end_turn',
    });

    const mcp = makeMCPClient();
    const agent = new Agent(mcp, {
      model: 'test-model',
      maxToolRounds: 5,
      region: 'us-east-1',
    });

    const result = await agent.run('system', 'user');
    expect(result.report).toBeNull();
    expect(result.rawText).toBe('Just some plain text response');
  });

  it('handles max rounds', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            {
              toolUse: {
                toolUseId: 'tool-loop',
                name: 'getFleetOverview',
                input: {},
              },
            },
          ],
        },
      },
      stopReason: 'tool_use',
    });

    const mcp = makeMCPClient();
    mcp.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'data' }],
      isError: false,
    });

    const agent = new Agent(mcp, {
      model: 'test-model',
      maxToolRounds: 2,
      region: 'us-east-1',
    });

    const result = await agent.run('system', 'user');
    expect(result.rounds).toBe(2);
  });

  it('handles report wrapped in markdown fences', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [{ text: '```json\n{"summary":"test","overallStatus":"warning","findings":[],"metrics":{}}\n```' }],
        },
      },
      stopReason: 'end_turn',
    });

    const mcp = makeMCPClient();
    const agent = new Agent(mcp, {
      model: 'test-model',
      maxToolRounds: 5,
      region: 'us-east-1',
    });

    const result = await agent.run('system', 'user');
    expect(result.report?.overallStatus).toBe('warning');
  });
});
