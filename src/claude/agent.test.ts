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

  describe('callToolWithRetry error paths', () => {
    /** Helper: first Bedrock call returns a tool_use, second returns end_turn. */
    function setupToolRoundTrip() {
      mockSend
        .mockResolvedValueOnce({
          output: {
            message: {
              content: [
                {
                  toolUse: {
                    toolUseId: 'tu-1',
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
            message: { content: [{ text: 'done' }] },
          },
          stopReason: 'end_turn',
        });
    }

    it('non-rate-limit tool errors return error text without retry', async () => {
      setupToolRoundTrip();

      const mcp = makeMCPClient();
      mcp.callTool.mockRejectedValue(new Error('connection refused'));

      const agent = new Agent(mcp, {
        model: 'test-model',
        maxToolRounds: 5,
        region: 'us-east-1',
      });

      const result = await agent.run('system', 'user');

      // callTool should only be called once — no retry for non-rate-limit errors
      expect(mcp.callTool).toHaveBeenCalledTimes(1);
      // The tool result pushed into messages will contain the error text.
      // The second Bedrock call sees it and responds with 'done'.
      expect(result.rounds).toBe(2);
    });

    it('rate limit on tool result.isError triggers retry', async () => {
      setupToolRoundTrip();

      const mcp = makeMCPClient();
      mcp.callTool
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'too many connections — try later' }],
          isError: true,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"totalDevices": 5}' }],
          isError: false,
        });

      const agent = new Agent(mcp, {
        model: 'test-model',
        maxToolRounds: 5,
        region: 'us-east-1',
      });

      const result = await agent.run('system', 'user');

      // Should have retried once after the rate-limited isError result
      expect(mcp.callTool).toHaveBeenCalledTimes(2);
      expect(result.rounds).toBe(2);
    }, 10_000);

    it('max retries exhausted returns error text', async () => {
      setupToolRoundTrip();

      const mcp = makeMCPClient();
      // All 3 attempts throw rate-limit errors
      mcp.callTool
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockRejectedValueOnce(new Error('rate limit exceeded'));

      const agent = new Agent(mcp, {
        model: 'test-model',
        maxToolRounds: 5,
        region: 'us-east-1',
      });

      const result = await agent.run('system', 'user');

      // All 3 retry attempts consumed
      expect(mcp.callTool).toHaveBeenCalledTimes(3);
      // Agent should still complete (the error text goes into tool result)
      expect(result.rounds).toBe(2);
    }, 15_000);
  });

  describe('parseReport edge cases', () => {
    it('empty text returns null report', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: { content: [{ text: '   ' }] },
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
    });

    it('text with no JSON braces returns null report', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: { content: [{ text: 'no json here at all' }] },
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
      expect(result.rawText).toBe('no json here at all');
    });

    it('valid JSON but missing required fields returns null report', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: '{"status":"ok","count":5}' }],
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
      expect(result.report).toBeNull();
    });

    it('invalid JSON within braces returns null report', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: '{ this is not: valid json }' }],
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
      expect(result.report).toBeNull();
    });
  });

  describe('Bedrock timeout', () => {
    it('AbortController triggers BedrockError', async () => {
      // Simulate the send hanging long enough that the abort fires.
      // Use a very short requestTimeoutMs so the abort fires quickly.
      mockSend.mockImplementation((_cmd: any, opts: any) => {
        return new Promise((_resolve, reject) => {
          // Listen for the abort signal and reject like the SDK would
          if (opts?.abortSignal) {
            opts.abortSignal.addEventListener('abort', () => {
              reject(new Error('Request was aborted'));
            });
          }
        });
      });

      const mcp = makeMCPClient();
      const agent = new Agent(mcp, {
        model: 'test-model',
        maxToolRounds: 5,
        region: 'us-east-1',
        requestTimeoutMs: 50, // very short timeout
      });

      await expect(agent.run('system', 'user')).rejects.toThrow(/timed out/);
    });
  });

  describe('executeRoundWithRetry', () => {
    it('non-rate-limit errors throw immediately without retry', async () => {
      mockSend.mockRejectedValue(new Error('invalid model ID'));

      const mcp = makeMCPClient();
      const agent = new Agent(mcp, {
        model: 'test-model',
        maxToolRounds: 5,
        region: 'us-east-1',
      });

      await expect(agent.run('system', 'user')).rejects.toThrow('invalid model ID');
      // Only one attempt — no retries for non-rate-limit errors
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('tool_use stopReason with no toolUseBlocks', () => {
    it('returns rawText as done when stopReason is not end_turn but no tool blocks', async () => {
      // Bedrock returns stopReason that is not end_turn, but the content
      // has no toolUse blocks — agent should treat it as done.
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: 'partial response with no tool calls' }],
          },
        },
        stopReason: 'max_tokens',
      });

      const mcp = makeMCPClient();
      const agent = new Agent(mcp, {
        model: 'test-model',
        maxToolRounds: 5,
        region: 'us-east-1',
      });

      const result = await agent.run('system', 'user');
      expect(result.rawText).toBe('partial response with no tool calls');
      expect(result.rounds).toBe(1);
      expect(result.toolCallCount).toBe(0);
    });
  });
});
