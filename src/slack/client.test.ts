import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPostMessage = vi.fn();
const mockAuthTest = vi.fn();

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage: mockPostMessage };
    auth = { test: mockAuthTest };
  },
}));

vi.mock('../metrics.js', () => ({
  recordSlackPost: vi.fn(async () => {}),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SlackClient } from './client.js';
import { SlackError } from '../errors.js';
import { logger } from '../logger.js';
import type { AgentReport, RemediationReport } from '../claude/types.js';

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
    mockAuthTest.mockResolvedValue({ ok: true });
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

  it('posts medium/low findings as summary in thread', async () => {
    const report = makeReport({
      findings: [
        {
          title: 'Medium issue',
          severity: 'medium',
          category: 'compliance',
          description: 'medium desc',
          affectedDeviceCount: 3,
          affectedDevices: [],
          remediation: { title: 'Fix', steps: [], effort: 'medium', automatable: false },
        },
        {
          title: 'Low issue',
          severity: 'low',
          category: 'maintenance',
          description: 'low desc',
          affectedDeviceCount: 7,
          affectedDevices: [],
          remediation: { title: 'Update', steps: ['step1'], effort: 'low', automatable: true },
        },
      ],
    });

    const client = new SlackClient('xoxb-test');
    await client.postReport('C123', report, 'compliance');

    // Header + summary thread for medium/low = 2 calls
    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    const summaryCall = mockPostMessage.mock.calls[1][0];
    expect(summaryCall.thread_ts).toBe('123.456');
    expect(summaryCall.text).toContain('Additional findings (2)');
    expect(summaryCall.text).toContain('[medium]');
    expect(summaryCall.text).toContain('[low]');
    expect(summaryCall.text).toContain('3 device(s)');
    expect(summaryCall.text).toContain('7 device(s)');
  });

  it('finding thread post failure logs warning and does not throw', async () => {
    const report = makeReport({
      findings: [
        {
          title: 'Critical vuln',
          severity: 'critical',
          category: 'security',
          description: 'desc',
          affectedDeviceCount: 1,
          affectedDevices: [{ name: 'mac1', id: '1', detail: 'test' }],
          remediation: { title: 'Patch', steps: ['patch'], effort: 'low', automatable: true },
        },
      ],
    });

    // Header succeeds, then finding thread post fails
    mockPostMessage
      .mockResolvedValueOnce({ ok: true, ts: '123.456' })
      .mockRejectedValueOnce(new Error('rate_limited'));

    const client = new SlackClient('xoxb-test');
    // Should not throw
    await client.postReport('C123', report, 'security');

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post finding thread: Critical vuln'),
      expect.objectContaining({ error: 'rate_limited' }),
    );
  });

  it('postError posts error blocks to channel', async () => {
    const client = new SlackClient('xoxb-test');
    await client.postError('C456', 'Timeout exceeded', 'scheduled compliance');

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const call = mockPostMessage.mock.calls[0][0];
    expect(call.channel).toBe('C456');
    expect(call.text).toContain('Timeout exceeded');
    expect(call.text).toContain('scheduled compliance');
    expect(call.blocks).toBeDefined();
  });

  it('postError throws SlackError with context on API failure', async () => {
    mockPostMessage.mockRejectedValue(new Error('account_inactive'));

    const client = new SlackClient('xoxb-test');

    try {
      await client.postError('C123', 'error msg', 'nightly scan');
      expect.fail('Expected SlackError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SlackError);
      const slackErr = err as InstanceType<typeof SlackError>;
      expect(slackErr.message).toBe('Failed to post error message');
      expect(slackErr.context).toEqual({ channelId: 'C123', errorContext: 'nightly scan' });
      expect(slackErr.cause).toBeInstanceOf(Error);
      expect((slackErr.cause as Error).message).toBe('account_inactive');
    }
  });

  it('skips thread replies when no critical/high findings exist', async () => {
    const report = makeReport({
      findings: [
        {
          title: 'Low priority',
          severity: 'low',
          category: 'maintenance',
          description: 'desc',
          affectedDeviceCount: 2,
          affectedDevices: [],
          remediation: { title: 'Fix', steps: [], effort: 'low', automatable: false },
        },
      ],
    });

    const client = new SlackClient('xoxb-test');
    await client.postReport('C123', report, 'compliance');

    // Header + low summary = 2 calls, no critical/high thread replies
    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    // First call is header (no thread_ts), second is summary (with thread_ts)
    expect(mockPostMessage.mock.calls[0][0].thread_ts).toBeUndefined();
    expect(mockPostMessage.mock.calls[1][0].thread_ts).toBe('123.456');
    expect(mockPostMessage.mock.calls[1][0].text).toContain('Additional findings (1)');
  });

  it('header post failure throws SlackError with context', async () => {
    mockPostMessage.mockRejectedValue(new Error('channel_not_found'));

    const client = new SlackClient('xoxb-test');

    try {
      await client.postReport('C999', makeReport(), 'inventory');
      expect.fail('Expected SlackError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SlackError);
      const slackErr = err as InstanceType<typeof SlackError>;
      expect(slackErr.message).toBe('Failed to post report header');
      expect(slackErr.context).toEqual({ channelId: 'C999', reportType: 'inventory' });
      expect(slackErr.operation).toBe('postReport');
      expect(slackErr.cause).toBeInstanceOf(Error);
      expect((slackErr.cause as Error).message).toBe('channel_not_found');
    }
  });

  describe('postRemediationReport', () => {
    function makeRemediationReport(overrides?: Partial<RemediationReport>): RemediationReport {
      return {
        summary: 'Remediated 1 finding.',
        originalReportStatus: 'warning',
        findingsAttempted: 1,
        findingsSucceeded: 1,
        findingsFailed: 0,
        actions: [],
        dryRun: false,
        ...overrides,
      };
    }

    it('posts remediation header to channel', async () => {
      const client = new SlackClient('xoxb-test');
      await client.postRemediationReport('C123', makeRemediationReport());

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage.mock.calls[0][0].channel).toBe('C123');
    });

    it('threads each action as a reply', async () => {
      const report = makeRemediationReport({
        actions: [
          {
            findingIndex: 0,
            findingTitle: 'Outdated OS',
            action: 'Updated OS',
            toolsUsed: ['createSoftwareUpdatePlan'],
            status: 'success',
            devicesRemediated: 5,
            details: 'Done',
          },
          {
            findingIndex: 1,
            findingTitle: 'Missing Encryption',
            action: 'Deployed profile',
            toolsUsed: ['deployConfigurationProfile'],
            status: 'success',
            devicesRemediated: 3,
            details: 'Done',
          },
        ],
      });

      const client = new SlackClient('xoxb-test');
      await client.postRemediationReport('C123', report);

      // Header + 2 action threads = 3 calls
      expect(mockPostMessage).toHaveBeenCalledTimes(3);
      expect(mockPostMessage.mock.calls[1][0].thread_ts).toBe('123.456');
      expect(mockPostMessage.mock.calls[2][0].thread_ts).toBe('123.456');
    });

    it('handles missing thread_ts gracefully', async () => {
      mockPostMessage.mockResolvedValueOnce({ ok: true, ts: undefined });

      const report = makeRemediationReport({
        actions: [
          {
            findingIndex: 0,
            findingTitle: 'Issue',
            action: 'Fixed',
            toolsUsed: [],
            status: 'success',
            devicesRemediated: 1,
            details: 'Done',
          },
        ],
      });

      const client = new SlackClient('xoxb-test');
      await client.postRemediationReport('C123', report);

      // Only header posted, no thread replies
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });

    it('throws SlackError on header post failure', async () => {
      mockPostMessage.mockRejectedValue(new Error('channel_not_found'));

      const client = new SlackClient('xoxb-test');

      await expect(
        client.postRemediationReport('C999', makeRemediationReport()),
      ).rejects.toThrow(SlackError);
    });

    it('action thread failure logs warning and does not throw', async () => {
      const report = makeRemediationReport({
        actions: [
          {
            findingIndex: 0,
            findingTitle: 'Test Action',
            action: 'Fix',
            toolsUsed: [],
            status: 'success',
            devicesRemediated: 1,
            details: 'Done',
          },
        ],
      });

      mockPostMessage
        .mockResolvedValueOnce({ ok: true, ts: '123.456' })
        .mockRejectedValueOnce(new Error('rate_limited'));

      const client = new SlackClient('xoxb-test');
      await client.postRemediationReport('C123', report);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post remediation action thread: Test Action'),
        expect.objectContaining({ error: 'rate_limited' }),
      );
    });

    it('uses "Dry Run" text for dry-run reports', async () => {
      const client = new SlackClient('xoxb-test');
      await client.postRemediationReport('C123', makeRemediationReport({ dryRun: true }));

      expect(mockPostMessage.mock.calls[0][0].text).toContain('Dry Run');
    });

    it('uses "Remediation" text for live reports', async () => {
      const client = new SlackClient('xoxb-test');
      await client.postRemediationReport('C123', makeRemediationReport({ dryRun: false }));

      expect(mockPostMessage.mock.calls[0][0].text).toContain('Remediation');
    });
  });

  it('medium/low summary thread failure logs warning and does not throw', async () => {
    const report = makeReport({
      findings: [
        {
          title: 'Medium issue',
          severity: 'medium',
          category: 'compliance',
          description: 'desc',
          affectedDeviceCount: 3,
          affectedDevices: [],
          remediation: { title: 'Fix', steps: [], effort: 'medium', automatable: false },
        },
      ],
    });

    // Header succeeds, then summary thread post fails
    mockPostMessage
      .mockResolvedValueOnce({ ok: true, ts: '123.456' })
      .mockRejectedValueOnce(new Error('rate_limited'));

    const client = new SlackClient('xoxb-test');
    // Should not throw
    await client.postReport('C123', report, 'compliance');

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to post additional findings summary',
      expect.objectContaining({ error: 'rate_limited' }),
    );
  });

  describe('testAuth', () => {
    it('resolves when auth.test succeeds', async () => {
      const client = new SlackClient('xoxb-test');
      await expect(client.testAuth()).resolves.toBeUndefined();
      expect(mockAuthTest).toHaveBeenCalledTimes(1);
    });

    it('throws SlackError when auth.test fails', async () => {
      mockAuthTest.mockRejectedValue(new Error('invalid_auth'));
      const client = new SlackClient('xoxb-test');

      await expect(client.testAuth()).rejects.toThrow(SlackError);
      try {
        await client.testAuth();
      } catch (err) {
        expect(err).toBeInstanceOf(SlackError);
        const slackErr = err as InstanceType<typeof SlackError>;
        expect(slackErr.operation).toBe('testAuth');
        expect((slackErr.cause as Error).message).toBe('invalid_auth');
      }
    });
  });

  it('finding thread failure with non-Error value logs stringified warning', async () => {
    const report = makeReport({
      findings: [
        {
          title: 'High issue',
          severity: 'high',
          category: 'security',
          description: 'desc',
          affectedDeviceCount: 1,
          affectedDevices: [{ name: 'mac1', id: '1', detail: 'test' }],
          remediation: { title: 'Fix', steps: [], effort: 'low', automatable: false },
        },
      ],
    });

    // Header succeeds, finding thread rejects with a non-Error value
    mockPostMessage
      .mockResolvedValueOnce({ ok: true, ts: '123.456' })
      .mockRejectedValueOnce('string_error');

    const client = new SlackClient('xoxb-test');
    await client.postReport('C123', report, 'security');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post finding thread: High issue'),
      expect.objectContaining({ error: 'string_error' }),
    );
  });
});
