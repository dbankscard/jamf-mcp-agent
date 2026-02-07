import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetNamespace = vi.fn();
const mockSetProperty = vi.fn();
const mockSetDimensions = vi.fn();
const mockPutMetric = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

vi.mock('aws-embedded-metrics', () => ({
  createMetricsLogger: () => ({
    setNamespace: mockSetNamespace,
    setProperty: mockSetProperty,
    setDimensions: mockSetDimensions,
    putMetric: mockPutMetric,
    flush: mockFlush,
  }),
  Unit: {
    Milliseconds: 'Milliseconds',
    Count: 'Count',
  },
}));

const mockGetRequestId = vi.fn();
const mockGetJobType = vi.fn();

vi.mock('./context.js', () => ({
  getRequestId: (...args: unknown[]) => mockGetRequestId(...args),
  getJobType: (...args: unknown[]) => mockGetJobType(...args),
}));

import {
  recordMCPConnectDuration,
  recordMCPToolCall,
  recordAgentRun,
  recordSchedulerJob,
  recordSlackPost,
} from './metrics.js';

describe('metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestId.mockReturnValue(undefined);
    mockGetJobType.mockReturnValue(undefined);
  });

  describe('recordMCPConnectDuration', () => {
    it('sets namespace, puts metric with correct name/value/unit, and flushes', async () => {
      await recordMCPConnectDuration(150);

      expect(mockSetNamespace).toHaveBeenCalledWith('JamfMCPAgent');
      expect(mockPutMetric).toHaveBeenCalledWith('mcp.connect.duration', 150, 'Milliseconds');
      expect(mockFlush).toHaveBeenCalled();
    });
  });

  describe('recordMCPToolCall', () => {
    it('sets toolName dimension, records duration', async () => {
      await recordMCPToolCall('listDevices', 200, false);

      expect(mockSetDimensions).toHaveBeenCalledWith({ toolName: 'listDevices' });
      expect(mockPutMetric).toHaveBeenCalledWith('mcp.tool_call.duration', 200, 'Milliseconds');
    });

    it('records error metric when error=true', async () => {
      await recordMCPToolCall('listDevices', 200, true);

      expect(mockPutMetric).toHaveBeenCalledWith('mcp.tool_call.errors', 1, 'Count');
    });

    it('does not record error metric when error=false', async () => {
      await recordMCPToolCall('listDevices', 200, false);

      expect(mockPutMetric).not.toHaveBeenCalledWith('mcp.tool_call.errors', expect.anything(), expect.anything());
    });
  });

  describe('recordAgentRun', () => {
    it('records duration, tool_calls count, and rounds count', async () => {
      await recordAgentRun(5000, 12, 3);

      expect(mockPutMetric).toHaveBeenCalledWith('agent.run.duration', 5000, 'Milliseconds');
      expect(mockPutMetric).toHaveBeenCalledWith('agent.run.tool_calls', 12, 'Count');
      expect(mockPutMetric).toHaveBeenCalledWith('agent.run.rounds', 3, 'Count');
      expect(mockFlush).toHaveBeenCalled();
    });
  });

  describe('recordSchedulerJob', () => {
    it('sets jobType dimension and records duration', async () => {
      await recordSchedulerJob('compliance-check', 3000, 'success');

      expect(mockSetDimensions).toHaveBeenCalledWith({ jobType: 'compliance-check' });
      expect(mockPutMetric).toHaveBeenCalledWith('scheduler.job.duration', 3000, 'Milliseconds');
    });

    it('records success count on status=success', async () => {
      await recordSchedulerJob('compliance-check', 3000, 'success');

      expect(mockPutMetric).toHaveBeenCalledWith('scheduler.job.success', 1, 'Count');
    });

    it('records error count on status=error', async () => {
      await recordSchedulerJob('compliance-check', 3000, 'error');

      expect(mockPutMetric).toHaveBeenCalledWith('scheduler.job.error', 1, 'Count');
    });
  });

  describe('recordSlackPost', () => {
    it('records duration', async () => {
      await recordSlackPost(100, false);

      expect(mockPutMetric).toHaveBeenCalledWith('slack.post.duration', 100, 'Milliseconds');
      expect(mockFlush).toHaveBeenCalled();
    });

    it('records error metric when error=true', async () => {
      await recordSlackPost(100, true);

      expect(mockPutMetric).toHaveBeenCalledWith('slack.post.errors', 1, 'Count');
    });

    it('does not record error metric when error=false', async () => {
      await recordSlackPost(100, false);

      expect(mockPutMetric).not.toHaveBeenCalledWith('slack.post.errors', expect.anything(), expect.anything());
    });
  });

  describe('context injection', () => {
    it('sets requestId property when getRequestId returns a value', async () => {
      mockGetRequestId.mockReturnValue('req-abc-123');

      await recordMCPConnectDuration(50);

      expect(mockSetProperty).toHaveBeenCalledWith('requestId', 'req-abc-123');
    });

    it('sets jobType dimension when getJobType returns a value', async () => {
      mockGetJobType.mockReturnValue('compliance-check');

      await recordMCPConnectDuration(50);

      expect(mockSetDimensions).toHaveBeenCalledWith({ jobType: 'compliance-check' });
    });

    it('does not set requestId property when getRequestId returns undefined', async () => {
      mockGetRequestId.mockReturnValue(undefined);

      await recordMCPConnectDuration(50);

      expect(mockSetProperty).not.toHaveBeenCalled();
    });

    it('does not set jobType dimension when getJobType returns undefined', async () => {
      mockGetJobType.mockReturnValue(undefined);

      await recordMCPConnectDuration(50);

      // setDimensions should not have been called at all since recordMCPConnectDuration
      // doesn't call setDimensions itself, and context jobType is undefined
      expect(mockSetDimensions).not.toHaveBeenCalled();
    });
  });
});
