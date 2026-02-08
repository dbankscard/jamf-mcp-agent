import { loadConfig } from './config.js';
import { MCPClient } from './mcp/client.js';
import { buildMCPOptions } from './mcp/options.js';
import { Agent } from './claude/agent.js';
import { SlackClient } from './slack/client.js';
import { startScheduler } from './scheduler/index.js';
import { logger } from './logger.js';
import { shutdownManager } from './shutdown.js';

async function main(): Promise<void> {
  logger.info('Jamf MCP Agent starting...');

  const config = await loadConfig();

  // 1. Connect to MCP server
  const mcp = new MCPClient(buildMCPOptions(config));

  await mcp.connect();

  // Register MCP cleanup
  shutdownManager.onShutdown(() => mcp.disconnect());

  // 2. Init Bedrock agent (read-only — use CLI for full control)
  const agent = new Agent(mcp, {
    model: config.bedrock.model,
    maxToolRounds: config.bedrock.maxToolRounds,
    maxTokens: config.bedrock.maxTokens,
    region: config.bedrock.region,
    accessKeyId: config.bedrock.accessKeyId,
    secretAccessKey: config.bedrock.secretAccessKey,
    requestTimeoutMs: config.bedrock.requestTimeoutMs,
    readOnlyTools: true,
  });

  // 3. Init Slack client (optional)
  const slack =
    config.slack.enabled && config.slack.botToken
      ? new SlackClient(config.slack.botToken)
      : null;

  if (slack) {
    logger.info('Slack integration enabled');
  } else {
    logger.info('Slack integration disabled');
  }

  // 4. Start scheduler (if enabled)
  if (config.scheduler.enabled) {
    startScheduler({ agent, slack, config, mcp });
  } else {
    logger.info('Scheduler disabled — use CLI commands or enable via SCHEDULER_ENABLED=true');
  }

  // 5. Install shutdown handler and keep alive
  shutdownManager.install();
  logger.info('Agent running. Press Ctrl+C to stop.');
}

main().catch(err => {
  logger.error('Fatal error', err);
  process.exit(1);
});
