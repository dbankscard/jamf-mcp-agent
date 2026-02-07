#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, type Config } from '../config.js';
import { MCPClient } from '../mcp/client.js';
import { Agent } from '../claude/agent.js';
import { SlackClient } from '../slack/client.js';
import { getSystemPrompt, ReportType } from '../claude/prompts.js';
import { runJob } from '../scheduler/index.js';
import { startScheduler } from '../scheduler/index.js';
import { logger } from '../logger.js';
import { shutdownManager } from '../shutdown.js';
import { HealthChecker } from '../health.js';

const program = new Command();

program
  .name('jamf-agent')
  .description('Jamf IT Admin Agent — proactive fleet monitoring & reporting')
  .version('1.0.0');

program
  .command('check <type>')
  .description('Run a report: compliance, security, or fleet')
  .option('--slack', 'Also post the report to Slack')
  .action(async (type: string, opts: { slack?: boolean }) => {
    if (!['compliance', 'security', 'fleet'].includes(type)) {
      console.error(`Unknown report type: ${type}. Use compliance, security, or fleet.`);
      process.exit(1);
    }

    const { agent, slack, mcp, config } = await boot();

    try {
      const slackClient = opts.slack ? slack : null;
      const channelId = config.slack.channels[type as keyof typeof config.slack.channels];
      await runJob(type as ReportType, agent, slackClient, channelId);
    } finally {
      await mcp.disconnect();
    }
  });

program
  .command('ask <question>')
  .description('Ask the agent an ad-hoc question about your Jamf environment')
  .action(async (question: string) => {
    const { agent, mcp } = await boot();

    try {
      const result = await agent.run(getSystemPrompt('adhoc'), question);
      if (result.report) {
        console.log(JSON.stringify(result.report, null, 2));
      } else {
        console.log(result.rawText);
      }
    } finally {
      await mcp.disconnect();
    }
  });

program
  .command('start')
  .description('Start in daemon mode with scheduled reports')
  .action(async () => {
    const { agent, slack, mcp, config } = await boot();

    shutdownManager.onShutdown(() => mcp.disconnect());
    startScheduler({ agent, slack, config });

    shutdownManager.install();
    logger.info('Agent running in daemon mode. Press Ctrl+C to stop.');
  });

program
  .command('health')
  .description('Check health of all components')
  .action(async () => {
    const config = await loadConfig();
    let mcp: MCPClient | null = null;
    try {
      const bootResult = await boot();
      mcp = bootResult.mcp;
    } catch {
      // MCP connection failed — run health check with null mcp
    }

    const checker = new HealthChecker(mcp, config);
    const status = await checker.getHealthStatus();

    console.log(JSON.stringify(status, null, 2));

    if (mcp) await mcp.disconnect();
    process.exit(status.status === 'healthy' ? 0 : 1);
  });

async function boot(): Promise<{ agent: Agent; slack: SlackClient | null; mcp: MCPClient; config: Config }> {
  const config = await loadConfig();

  const mcpOptions = config.mcp.transport === 'http'
    ? {
        transport: 'http' as const,
        serverUrl: config.mcp.serverUrl!,
        connectTimeoutMs: config.mcp.connectTimeoutMs,
        toolTimeoutMs: config.mcp.toolTimeoutMs,
        maxReconnectAttempts: config.mcp.maxReconnectAttempts,
        reconnectBaseMs: config.mcp.reconnectBaseMs,
      }
    : {
        transport: 'stdio' as const,
        command: 'node',
        args: [config.mcp.serverPath!],
        env: {
          JAMF_URL: config.mcp.jamfUrl!,
          JAMF_CLIENT_ID: config.mcp.jamfClientId!,
          JAMF_CLIENT_SECRET: config.mcp.jamfClientSecret!,
        },
        connectTimeoutMs: config.mcp.connectTimeoutMs,
        toolTimeoutMs: config.mcp.toolTimeoutMs,
        maxReconnectAttempts: config.mcp.maxReconnectAttempts,
        reconnectBaseMs: config.mcp.reconnectBaseMs,
      };

  const mcp = new MCPClient(mcpOptions);

  await mcp.connect();

  const agent = new Agent(mcp, {
    model: config.bedrock.model,
    maxToolRounds: config.bedrock.maxToolRounds,
    region: config.bedrock.region,
    accessKeyId: config.bedrock.accessKeyId,
    secretAccessKey: config.bedrock.secretAccessKey,
    requestTimeoutMs: config.bedrock.requestTimeoutMs,
  });

  const slack =
    config.slack.enabled && config.slack.botToken
      ? new SlackClient(config.slack.botToken)
      : null;

  return { agent, slack, mcp, config };
}

program.parse();
