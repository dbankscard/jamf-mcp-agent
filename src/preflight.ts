import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { MCPClient } from './mcp/client.js';
import { SlackClient } from './slack/client.js';
import { Config } from './config.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';

export interface PreflightDeps {
  mcp: MCPClient;
  slack: SlackClient | null;
  config: Config;
}

export async function preflight(deps: PreflightDeps): Promise<void> {
  const errors: string[] = [];

  // 1. MCP check
  try {
    if (!deps.mcp.isConnected()) {
      errors.push('MCP: not connected');
    } else if (deps.mcp.getToolCount() === 0) {
      errors.push('MCP: connected but no tools discovered');
    }
  } catch (err: any) {
    errors.push(`MCP: ${err.message}`);
  }

  // 2. Slack check
  try {
    if (deps.slack) {
      await deps.slack.testAuth();
    }
  } catch (err: any) {
    errors.push(`Slack: ${err.message}`);
  }

  // 3. Bedrock check
  try {
    const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {
      region: deps.config.bedrock.region,
    };
    if (deps.config.bedrock.accessKeyId && deps.config.bedrock.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: deps.config.bedrock.accessKeyId,
        secretAccessKey: deps.config.bedrock.secretAccessKey,
      };
    }
    const client = new BedrockRuntimeClient(clientConfig);
    await client.send(
      new ConverseCommand({
        modelId: deps.config.bedrock.model,
        messages: [{ role: 'user', content: [{ text: 'ping' }] }],
        inferenceConfig: { maxTokens: 1 },
      }),
    );
  } catch (err: any) {
    errors.push(`Bedrock: ${err.message}`);
  }

  if (errors.length > 0) {
    throw new Error(`Preflight failed:\n  - ${errors.join('\n  - ')}`);
  }
}

export function logStartupBanner(config: Config): void {
  logger.info('=== Jamf MCP Agent ===');
  logger.info(`Transport: ${config.mcp.transport}`);
  logger.info(`Model: ${config.bedrock.model}`);
  logger.info(`Scheduler: ${config.scheduler.enabled ? 'enabled' : 'disabled'}`);
  if (config.scheduler.enabled) {
    logger.info(`  Compliance: ${config.scheduler.cron.compliance}`);
    logger.info(`  Security:   ${config.scheduler.cron.security}`);
    logger.info(`  Fleet:      ${config.scheduler.cron.fleet}`);
    logger.info(`  Timezone:   ${config.scheduler.timezone}`);
  }
  logger.info(`Slack: ${config.slack.enabled ? 'enabled' : 'disabled'}`);
  if (config.slack.enabled) {
    const channels = Object.entries(config.slack.channels)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (channels) logger.info(`  Channels: ${channels}`);
  }
  logger.info(`Health port: ${config.healthPort}`);
}

export async function loadConfigWithRetry(
  maxAttempts = 3,
  baseMs = 1000,
): Promise<Config> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await loadConfig();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseMs * 2 ** (attempt - 1);
        logger.warn(`Config load failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}
