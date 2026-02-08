import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

vi.mock('../metrics.js', () => ({
  recordSchedulerJob: vi.fn(async () => {}),
}));

vi.mock('../context.js', () => ({
  runWithContext: vi.fn((fn: () => any) => fn()),
  getRequestId: vi.fn(() => 'test-id'),
  getJobType: vi.fn(() => undefined),
}));

const mockTrackOperation = vi.fn<(label: string) => () => void>(() => vi.fn());

vi.mock('../shutdown.js', () => ({
  shutdownManager: {
    trackOperation: (label: string) => mockTrackOperation(label),
  },
}));

import { runJob, startScheduler, getRunningJobs } from './index.js';
import { recordSchedulerJob } from '../metrics.js';
import cron from 'node-cron';
import type { Config } from '../config.js';

// Config with 0 retries for fast tests
const testConfig = {
  scheduler: {
    timezone: 'UTC',
    maxRetries: 0,
    retryBackoffMs: 10,
    cron: { compliance: '0 8 * * *', security: '0 9 * * *', fleet: '0 10 * * 1' },
  },
  slack: { channels: {} },
} as Config;

function makeAgent(mockResult?: any) {
  return {
    run: vi.fn().mockResolvedValue(
      mockResult ?? {
        report: {
          summary: 'test',
          overallStatus: 'healthy',
          findings: [],
          metrics: {},
        },
        rawText: '{}',
        toolCallCount: 2,
        rounds: 1,
      },
    ),
  } as any;
}

function makeSlack() {
  return {
    postReport: vi.fn().mockResolvedValue(undefined),
    postError: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('runJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs a job and produces a report', async () => {
    const agent = makeAgent();
    const slack = makeSlack();

    await runJob('compliance', agent, slack, 'C123', undefined, testConfig);

    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(slack.postReport).toHaveBeenCalledTimes(1);
  });

  it('skips job if already running', async () => {
    const agent = makeAgent({
      report: null,
      rawText: 'pending...',
      toolCallCount: 0,
      rounds: 0,
    });

    // Simulate slow job
    agent.run.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        report: { summary: 't', overallStatus: 'healthy', findings: [], metrics: {} },
        rawText: '{}',
        toolCallCount: 0,
        rounds: 1,
      }), 200)),
    );

    // Start first job (don't await)
    const job1 = runJob('compliance', agent, null, undefined, undefined, testConfig);

    // Wait a tick for the first job to start
    await new Promise(r => setTimeout(r, 50));

    // Second job should be skipped
    await runJob('compliance', agent, null, undefined, undefined, testConfig);

    // Wait for first to finish
    await job1;

    // Only one run call
    expect(agent.run).toHaveBeenCalledTimes(1);
  });

  it('emits skipped metric when job is already running', async () => {
    const agent = makeAgent();

    // Simulate slow job
    agent.run.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        report: { summary: 't', overallStatus: 'healthy', findings: [], metrics: {} },
        rawText: '{}',
        toolCallCount: 0,
        rounds: 1,
      }), 200)),
    );

    const job1 = runJob('compliance', agent, null, undefined, undefined, testConfig);
    await new Promise(r => setTimeout(r, 50));

    await runJob('compliance', agent, null, undefined, undefined, testConfig);
    await job1;

    expect(recordSchedulerJob).toHaveBeenCalledWith('compliance', 0, 'skipped');
  });

  it('releases lock after job completes', async () => {
    const agent = makeAgent();
    await runJob('security', agent, null, undefined, undefined, testConfig);
    expect(getRunningJobs()).not.toContain('security');
  });

  it('releases lock after job error', async () => {
    const agent = makeAgent();
    agent.run.mockRejectedValue(new Error('boom'));

    await runJob('fleet', agent, null, undefined, undefined, testConfig);
    expect(getRunningJobs()).not.toContain('fleet');
  });

  it('tracks operation for graceful shutdown', async () => {
    const mockDone = vi.fn();
    mockTrackOperation.mockReturnValue(mockDone);

    const agent = makeAgent();
    await runJob('compliance', agent, null, undefined, undefined, testConfig);

    expect(mockTrackOperation).toHaveBeenCalledWith('compliance-job');
    expect(mockDone).toHaveBeenCalledTimes(1);
  });

  it('releases shutdown tracking on job error', async () => {
    const mockDone = vi.fn();
    mockTrackOperation.mockReturnValue(mockDone);

    const agent = makeAgent();
    agent.run.mockRejectedValue(new Error('agent failed'));

    await runJob('security', agent, null, undefined, undefined, testConfig);

    expect(mockTrackOperation).toHaveBeenCalledWith('security-job');
    expect(mockDone).toHaveBeenCalledTimes(1);
  });

  it('posts error to Slack on job failure', async () => {
    const agent = makeAgent();
    agent.run.mockRejectedValue(new Error('agent failed'));
    const slack = makeSlack();

    await runJob('compliance', agent, slack, 'C123', undefined, testConfig);

    expect(slack.postError).toHaveBeenCalledTimes(1);
    expect(slack.postError.mock.calls[0][1]).toBe('agent failed');
  });

  it('runs without Slack', async () => {
    const agent = makeAgent();
    await runJob('compliance', agent, null, undefined, undefined, testConfig);
    expect(agent.run).toHaveBeenCalledTimes(1);
  });

  it('retries on failure when maxRetries > 0', async () => {
    const retryConfig = { ...testConfig, scheduler: { ...testConfig.scheduler, maxRetries: 1, retryBackoffMs: 10 } } as Config;
    const agent = makeAgent();
    agent.run
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({
        report: { summary: 'ok', overallStatus: 'healthy', findings: [], metrics: {} },
        rawText: '{}',
        toolCallCount: 1,
        rounds: 1,
      });

    await runJob('compliance', agent, null, undefined, undefined, retryConfig);

    expect(agent.run).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and posts error', async () => {
    const retryConfig = { ...testConfig, scheduler: { ...testConfig.scheduler, maxRetries: 1, retryBackoffMs: 10 } } as Config;
    const agent = makeAgent();
    agent.run.mockRejectedValue(new Error('persistent failure'));
    const slack = makeSlack();

    await runJob('compliance', agent, slack, 'C123', undefined, retryConfig);

    // 1 initial + 1 retry = 2 attempts
    expect(agent.run).toHaveBeenCalledTimes(2);
    expect(slack.postError).toHaveBeenCalledTimes(1);
  });
});

describe('runJob — timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('job timeout triggers failure and releases lock', async () => {
    const timeoutConfig = {
      ...testConfig,
      scheduler: { ...testConfig.scheduler, maxRetries: 0, jobTimeoutMs: 50 },
    } as Config;

    const agent = makeAgent();
    // Simulate a slow agent that exceeds timeout
    agent.run.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        report: { summary: 't', overallStatus: 'healthy', findings: [], metrics: {} },
        rawText: '{}',
        toolCallCount: 0,
        rounds: 1,
      }), 500)),
    );

    await runJob('compliance', agent, null, undefined, undefined, timeoutConfig);

    // Job should have failed via timeout, lock released
    expect(getRunningJobs()).not.toContain('compliance');
    expect(recordSchedulerJob).toHaveBeenCalledWith('compliance', expect.any(Number), 'error');
  });

  it('retries after timeout failure', async () => {
    const timeoutConfig = {
      ...testConfig,
      scheduler: { ...testConfig.scheduler, maxRetries: 1, retryBackoffMs: 10, jobTimeoutMs: 50 },
    } as Config;

    const agent = makeAgent();
    // First call times out, second succeeds quickly
    agent.run
      .mockImplementationOnce(
        () => new Promise(resolve => setTimeout(() => resolve({
          report: { summary: 't', overallStatus: 'healthy', findings: [], metrics: {} },
          rawText: '{}',
          toolCallCount: 0,
          rounds: 1,
        }), 500)),
      )
      .mockResolvedValueOnce({
        report: { summary: 'ok', overallStatus: 'healthy', findings: [], metrics: {} },
        rawText: '{}',
        toolCallCount: 1,
        rounds: 1,
      });

    await runJob('compliance', agent, null, undefined, undefined, timeoutConfig);

    expect(agent.run).toHaveBeenCalledTimes(2);
    expect(recordSchedulerJob).toHaveBeenCalledWith('compliance', expect.any(Number), 'success');
  });
});

describe('startScheduler', () => {
  it('registers cron jobs', () => {
    const agent = makeAgent();

    startScheduler({ agent, slack: null, config: testConfig });

    expect(cron.schedule).toHaveBeenCalledTimes(3);
  });
});

describe('getRunningJobs', () => {
  it('returns running job types during execution', async () => {
    let capturedRunning: string[] = [];
    const agent = makeAgent();
    agent.run.mockImplementation(async () => {
      // Capture running jobs while inside agent.run
      capturedRunning = getRunningJobs();
      return {
        report: { summary: 't', overallStatus: 'healthy', findings: [], metrics: {} },
        rawText: '{}',
        toolCallCount: 0,
        rounds: 1,
      };
    });

    await runJob('security', agent, null, undefined, undefined, testConfig);

    // During execution, 'security' should have been in the running list
    expect(capturedRunning).toContain('security');
    // After completion, it should be cleared
    expect(getRunningJobs()).not.toContain('security');
  });
});

describe('runJob — no structured report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs warning and prints rawText when no structured report', async () => {
    const agent = makeAgent({
      report: null,
      rawText: 'raw output text here',
      toolCallCount: 1,
      rounds: 1,
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runJob('compliance', agent, null, undefined, undefined, testConfig);

    // Should print rawText to console since report is null
    expect(consoleSpy).toHaveBeenCalledWith('raw output text here');
    consoleSpy.mockRestore();
  });
});

describe('runJob — Slack postError failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('catches Slack postError failure silently', async () => {
    const agent = makeAgent();
    agent.run.mockRejectedValue(new Error('agent exploded'));

    const slack = makeSlack();
    // postError itself throws
    slack.postError.mockRejectedValue(new Error('Slack is down'));

    // This should NOT throw even though postError fails
    await expect(runJob('compliance', agent, slack, 'C123', undefined, testConfig)).resolves.toBeUndefined();
  });
});
