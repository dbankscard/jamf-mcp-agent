import { WebClient } from '@slack/web-api';
import { AgentReport, RemediationReport } from '../claude/types.js';
import { buildReportHeader, buildFindingBlocks, buildErrorBlocks, buildRemediationHeader, buildRemediationActionBlocks } from './templates.js';
import { logger } from '../logger.js';
import { SlackError } from '../errors.js';
import { recordSlackPost } from '../metrics.js';

export class SlackClient {
  private web: WebClient;

  constructor(botToken: string) {
    this.web = new WebClient(botToken);
  }

  /**
   * Post a full report: summary header in the channel, then each
   * critical/high finding as a threaded reply.
   */
  async postReport(channelId: string, report: AgentReport, reportType: string): Promise<void> {
    const headerBlocks = buildReportHeader(report, reportType);

    let headerResult;
    const start = Date.now();
    try {
      headerResult = await this.web.chat.postMessage({
        channel: channelId,
        blocks: headerBlocks as any,
        text: `${reportType} report: ${report.overallStatus} — ${report.summary}`,
      });
      recordSlackPost(Date.now() - start, false).catch(() => {});
    } catch (err) {
      recordSlackPost(Date.now() - start, true).catch(() => {});
      throw new SlackError('Failed to post report header', {
        operation: 'postReport',
        context: { channelId, reportType },
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    const threadTs = headerResult.ts;
    if (!threadTs) {
      logger.warn('Could not get thread ts from header message');
      return;
    }

    // Thread critical and high findings
    const importantFindings = report.findings.filter(
      f => f.severity === 'critical' || f.severity === 'high',
    );

    for (const finding of importantFindings) {
      const blocks = buildFindingBlocks(finding);
      try {
        await this.web.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: blocks as any,
          text: `[${finding.severity.toUpperCase()}] ${finding.title}`,
        });
      } catch (err) {
        logger.warn(`Failed to post finding thread: ${finding.title}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // If there are medium/low findings, post a short summary in thread
    const otherFindings = report.findings.filter(
      f => f.severity === 'medium' || f.severity === 'low',
    );
    if (otherFindings.length > 0) {
      const summaryLines = otherFindings
        .map(f => `• *[${f.severity}]* ${f.title} — ${f.affectedDeviceCount} device(s)`)
        .join('\n');

      await this.web.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `*Additional findings (${otherFindings.length}):*\n${summaryLines}`,
      });
    }

    logger.info(`Posted report to Slack channel ${channelId}`);
  }

  /**
   * Post a remediation report: summary header in the channel, then each
   * action as a threaded reply.
   */
  async postRemediationReport(channelId: string, report: RemediationReport): Promise<void> {
    const headerBlocks = buildRemediationHeader(report);
    const mode = report.dryRun ? 'Dry Run' : 'Remediation';

    let headerResult;
    const start = Date.now();
    try {
      headerResult = await this.web.chat.postMessage({
        channel: channelId,
        blocks: headerBlocks as any,
        text: `${mode}: ${report.summary}`,
      });
      recordSlackPost(Date.now() - start, false).catch(() => {});
    } catch (err) {
      recordSlackPost(Date.now() - start, true).catch(() => {});
      throw new SlackError('Failed to post remediation header', {
        operation: 'postRemediationReport',
        context: { channelId },
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    const threadTs = headerResult.ts;
    if (!threadTs) {
      logger.warn('Could not get thread ts from remediation header message');
      return;
    }

    for (const action of report.actions) {
      const blocks = buildRemediationActionBlocks(action);
      try {
        await this.web.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: blocks as any,
          text: `[${action.status.toUpperCase()}] ${action.findingTitle}`,
        });
      } catch (err) {
        logger.warn(`Failed to post remediation action thread: ${action.findingTitle}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info(`Posted remediation report to Slack channel ${channelId}`);
  }

  async postError(channelId: string, error: string, context: string): Promise<void> {
    const blocks = buildErrorBlocks(error, context);
    try {
      await this.web.chat.postMessage({
        channel: channelId,
        blocks: blocks as any,
        text: `Agent error during ${context}: ${error}`,
      });
    } catch (err) {
      throw new SlackError('Failed to post error message', {
        operation: 'postError',
        context: { channelId, errorContext: context },
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
}
