import { createMetricsLogger, Unit } from 'aws-embedded-metrics';
import { getRequestId, getJobType } from './context.js';

const NAMESPACE = 'JamfMCPAgent';

async function withMetrics(fn: (m: ReturnType<typeof createMetricsLogger>) => void): Promise<void> {
  const metrics = createMetricsLogger();
  metrics.setNamespace(NAMESPACE);

  const requestId = getRequestId();
  if (requestId) metrics.setProperty('requestId', requestId);

  const jobType = getJobType();
  if (jobType) metrics.setDimensions({ jobType });

  fn(metrics);

  await metrics.flush();
}

export async function recordMCPConnectDuration(durationMs: number): Promise<void> {
  await withMetrics(m => {
    m.putMetric('mcp.connect.duration', durationMs, Unit.Milliseconds);
  });
}

export async function recordMCPToolCall(
  toolName: string,
  durationMs: number,
  error: boolean,
): Promise<void> {
  await withMetrics(m => {
    m.setDimensions({ toolName });
    m.putMetric('mcp.tool_call.duration', durationMs, Unit.Milliseconds);
    if (error) {
      m.putMetric('mcp.tool_call.errors', 1, Unit.Count);
    }
  });
}

export async function recordAgentRun(
  durationMs: number,
  toolCalls: number,
  rounds: number,
): Promise<void> {
  await withMetrics(m => {
    m.putMetric('agent.run.duration', durationMs, Unit.Milliseconds);
    m.putMetric('agent.run.tool_calls', toolCalls, Unit.Count);
    m.putMetric('agent.run.rounds', rounds, Unit.Count);
  });
}

export async function recordSchedulerJob(
  jobType: string,
  durationMs: number,
  status: 'success' | 'error',
): Promise<void> {
  await withMetrics(m => {
    m.setDimensions({ jobType });
    m.putMetric('scheduler.job.duration', durationMs, Unit.Milliseconds);
    m.putMetric(`scheduler.job.${status}`, 1, Unit.Count);
  });
}

export async function recordSlackPost(
  durationMs: number,
  error: boolean,
): Promise<void> {
  await withMetrics(m => {
    m.putMetric('slack.post.duration', durationMs, Unit.Milliseconds);
    if (error) {
      m.putMetric('slack.post.errors', 1, Unit.Count);
    }
  });
}
