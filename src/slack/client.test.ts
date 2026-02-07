import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPostMessage = vi.fn();

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage: mockPostMessage };
  },
}));

vi.mock('../metrics.js', () => ({
  recordSlackPost: vi.fn(async () => {}),
}));

import { SlackClient } from './client.js';
import { SlackError } from '../errors.js';
import type { AgentReport } from '../claude/types.js';

function makeReport(overrides?: Partial<AgentReport>): AgentReport {
  return {
    summary: 'Test summary',
    overallStatus: 'healthy',
    findings: [],
    metrics: { totalDevices: 10 },
    ...overrides,
  };
}

describe('SlackClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostMessage.mockResolvedValue({ ok: true, ts: '123.456' });
  });

  it('posts report header to channel', async () => {
    const client = new SlackClient('xoxb-test');
    await client.postReport('C123', makeReport(), 'compliance');

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage.mock.calls[0][0].channel).toBe('C123');
  });

  it('threads critical/high findings', async () => {
    const report = makeReport({
      findings: [
        {
          title: 'Critical issue',
          severity: 'critical',
          category: 'security',
          description: 'desc',
          affectedDeviceCount: 1,
          affectedDevices: [{ name: 'mac1', id: '1', detail: 'test' }],
          remediation: { title: 'Fix it', steps: ['step1'], effort: 'low', automatable: true },
        },
        {
          title: 'Low issue',
          severity: 'low',
          category: 'compliance',
          description: 'desc',
          affectedDeviceCount: 1,
          affectedDevices: [],
          remediation: { title: 'Fix', steps: [], effort: 'low', automatable: false },
        },
      ],
    });

    const client = new SlackClient('xoxb-test');
    await client.postReport('C123', report, 'security');

    // Header + critical finding thread + low summary thread = 3 calls
    expect(mockPostMessage).toHaveBeenCalledTimes(3);
    expect(mockPostMessage.mock.calls[1][0].thread_ts).toBe('123.456');
  });

  it('handles missing thread_ts gracefully', async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: undefined });

    const client = new SlackClient('xoxb-test');
    const report = makeReport({
      findings: [
        {
          title: 'test',
          severity: 'critical',
          category: 'security',
          description: 'desc',
          affectedDeviceCount: 0,
          affectedDevices: [],
          remediation: { title: 'fix', steps: [], effort: 'low', automatable: false },
        },
      ],
    });

    await client.postReport('C123', report, 'security');
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it('throws SlackError on postReport failure', async () => {
    mockPostMessage.mockRejectedValue(new Error('channel_not_found'));

    const client = new SlackClient('xoxb-test');

    await expect(
      client.postReport('C999', makeReport(), 'compliance'),
    ).rejects.toThrow(SlackError);
  });

  it('posts error message', async () => {
    const client = new SlackClient('xoxb-test');
    await client.postError('C123', 'Something broke', 'compliance report');

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage.mock.calls[0][0].text).toContain('Something broke');
  });

  it('throws SlackError on postError failure', async () => {
    mockPostMessage.mockRejectedValue(new Error('invalid_auth'));

    const client = new SlackClient('xoxb-test');

    await expect(
      client.postError('C123', 'error', 'context'),
    ).rejects.toThrow(SlackError);
  });
});
