import * as fs from 'node:fs';
import { Agent } from '../claude/agent.js';
import { MCPClient } from '../mcp/client.js';
import { getSystemPrompt, getUserMessage, getResourceUris, buildResourceContext, ReportType } from '../claude/prompts.js';
import { SlackClient } from '../slack/client.js';
import { Config } from '../config.js';
import { logger } from '../logger.js';
import { recordSchedulerJob } from '../metrics.js';
import { runWithContext } from '../context.js';
import { shutdownManager } from '../shutdown.js';
import { withTimeout } from '../utils.js';
import cron from 'node-cron';

export interface SchedulerDeps {
  agent: Agent;
  slack: SlackClient | null;
  config: Config;
  mcp?: MCPClient;
}

const runningJobs = new Map<ReportType, boolean>();

export function getRunningJobs(): ReportType[] {
  return Array.from(runningJobs.entries())
    .filter(([, running]) => running)
    .map(([type]) => type);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function startScheduler(deps: SchedulerDeps): void {
  const { agent, slack, config, mcp } = deps;
  const tz = config.scheduler.timezone;

  schedule('compliance', config.scheduler.cron.compliance, tz, agent, slack, config.slack.channels.compliance, config, mcp);
  schedule('security', config.scheduler.cron.security, tz, agent, slack, config.slack.channels.security, config, mcp);
  schedule('fleet', config.scheduler.cron.fleet, tz, agent, slack, config.slack.channels.fleet, config, mcp);

  logger.info('Scheduler started');
}

function schedule(
  type: ReportType,
  expression: string,
  timezone: string,
  agent: Agent,
  slack: SlackClient | null,
  channelId: string | undefined,
  config: Config,
  mcp?: MCPClient,
): void {
  cron.schedule(expression, () => void runJob(type, agent, slack, channelId, undefined, config, mcp), { timezone });
  logger.info(`Scheduled ${type} report: ${expression} (${timezone})`);
}

async function fetchResources(mcp: MCPClient, uris: string[]): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const uri of uris) {
    try {
      results[uri] = await mcp.readResource(uri);
    } catch (err: any) {
      logger.warn(`Failed to fetch resource ${uri}: ${err.message}`);
    }
  }
  return results;
}

export async function runJob(
  type: ReportType,
  agent: Agent,
  slack: SlackClient | null,
  channelId: string | undefined,
  savePath?: string,
  config?: Config,
  mcp?: MCPClient,
): Promise<void> {
  if (runningJobs.get(type)) {
    logger.warn(`Skipping ${type} job — previous run still in progress`);
    recordSchedulerJob(type, 0, 'skipped').catch(() => {});
    return;
  }

  const maxRetries = config?.scheduler.maxRetries ?? 2;
  const retryBackoffMs = config?.scheduler.retryBackoffMs ?? 30_000;
  const jobTimeoutMs = config?.scheduler.jobTimeoutMs ?? 600_000;

  return runWithContext(async () => {
    runningJobs.set(type, true);
    const done = shutdownManager.trackOperation(`${type}-job`);
    const start = Date.now();
    logger.info(`Running ${type} job...`);

    let lastError: Error | null = null;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const delay = retryBackoffMs * 2 ** (attempt - 1);
          logger.warn(`Retrying ${type} job (attempt ${attempt + 1}/${maxRetries + 1}) in ${delay}ms...`);
          await sleep(delay);
        }

        try {
          // Fetch pre-aggregated resources to reduce tool calls
          let userMessage = getUserMessage(type);
          if (mcp) {
            const resourceUris = getResourceUris(type);
            if (resourceUris.length > 0) {
              const resources = await fetchResources(mcp, resourceUris);
              userMessage += buildResourceContext(resources);
            }
          }

          const result = await withTimeout(
            agent.run(getSystemPrompt(type), userMessage),
            jobTimeoutMs,
            `${type}-job`,
            'scheduler',
          );

          if (result.report) {
            logger.info(`${type} report: status=${result.report.overallStatus}, findings=${result.report.findings.length}`);
          } else {
            logger.warn(`${type} job produced no structured report`);
          }

          // Print to console
          if (result.report) {
            const json = JSON.stringify(result.report, null, 2);
            console.log(json);
            if (savePath) fs.writeFileSync(savePath, json + '\n', 'utf-8');
          } else {
            console.log(result.rawText);
            if (savePath) fs.writeFileSync(savePath, result.rawText + '\n', 'utf-8');
          }

          // Post to Slack
          if (slack && channelId && result.report) {
            await slack.postReport(channelId, result.report, type);
          }

          recordSchedulerJob(type, Date.now() - start, 'success').catch(() => {});
          return; // success — exit retry loop
        } catch (err: any) {
          lastError = err;
          logger.error(`${type} job failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}`);
        }
      }

      // All attempts exhausted
      recordSchedulerJob(type, Date.now() - start, 'error').catch(() => {});
      if (slack && channelId && lastError) {
        await slack.postError(channelId, lastError.message, `${type} report`).catch(() => {});
      }
    } finally {
      done();
      runningJobs.set(type, false);
    }
  }, type);
}
