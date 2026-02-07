import cron from 'node-cron';
import { Agent } from '../claude/agent.js';
import { getSystemPrompt, getUserMessage, ReportType } from '../claude/prompts.js';
import { SlackClient } from '../slack/client.js';
import { Config } from '../config.js';
import { logger } from '../logger.js';
import { recordSchedulerJob } from '../metrics.js';
import { runWithContext } from '../context.js';

export interface SchedulerDeps {
  agent: Agent;
  slack: SlackClient | null;
  config: Config;
}

const runningJobs = new Map<ReportType, boolean>();

export function getRunningJobs(): ReportType[] {
  return Array.from(runningJobs.entries())
    .filter(([, running]) => running)
    .map(([type]) => type);
}

export function startScheduler(deps: SchedulerDeps): void {
  const { agent, slack, config } = deps;
  const tz = config.scheduler.timezone;

  schedule('compliance', config.scheduler.cron.compliance, tz, agent, slack, config.slack.channels.compliance);
  schedule('security', config.scheduler.cron.security, tz, agent, slack, config.slack.channels.security);
  schedule('fleet', config.scheduler.cron.fleet, tz, agent, slack, config.slack.channels.fleet);

  logger.info('Scheduler started');
}

function schedule(
  type: ReportType,
  expression: string,
  timezone: string,
  agent: Agent,
  slack: SlackClient | null,
  channelId: string | undefined,
): void {
  cron.schedule(expression, () => void runJob(type, agent, slack, channelId), { timezone });
  logger.info(`Scheduled ${type} report: ${expression} (${timezone})`);
}

export async function runJob(
  type: ReportType,
  agent: Agent,
  slack: SlackClient | null,
  channelId: string | undefined,
): Promise<void> {
  if (runningJobs.get(type)) {
    logger.warn(`Skipping ${type} job — previous run still in progress`);
    return;
  }

  return runWithContext(async () => {
    runningJobs.set(type, true);
    const start = Date.now();
    logger.info(`Running ${type} job...`);

    try {
      const result = await agent.run(getSystemPrompt(type), getUserMessage(type));

      if (result.report) {
        logger.info(`${type} report: status=${result.report.overallStatus}, findings=${result.report.findings.length}`);
      } else {
        logger.warn(`${type} job produced no structured report`);
      }

      // Print to console
      if (result.report) {
        console.log(JSON.stringify(result.report, null, 2));
      } else {
        console.log(result.rawText);
      }

      // Post to Slack
      if (slack && channelId && result.report) {
        await slack.postReport(channelId, result.report, type);
      }

      recordSchedulerJob(type, Date.now() - start, 'success').catch(() => {});
    } catch (err: any) {
      logger.error(`${type} job failed: ${err.message}`);
      recordSchedulerJob(type, Date.now() - start, 'error').catch(() => {});
      if (slack && channelId) {
        await slack.postError(channelId, err.message, `${type} report`).catch(() => {});
      }
    } finally {
      runningJobs.set(type, false);
    }
  }, type);
}
