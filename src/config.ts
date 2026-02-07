import { z } from 'zod';
import 'dotenv/config';
import { ConfigError } from './errors.js';
import { fetchSecrets } from './secrets.js';

const mcpSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  // stdio mode
  serverPath: z.string().min(1).optional(),
  jamfUrl: z.string().url().optional(),
  jamfClientId: z.string().min(1).optional(),
  jamfClientSecret: z.string().min(1).optional(),
  // http mode
  serverUrl: z.string().url().optional(),
  // timeouts & reconnection
  connectTimeoutMs: z.number().int().positive().default(30_000),
  toolTimeoutMs: z.number().int().positive().default(120_000),
  maxReconnectAttempts: z.number().int().nonnegative().default(5),
  reconnectBaseMs: z.number().int().positive().default(1_000),
}).superRefine((data, ctx) => {
  if (data.transport === 'stdio') {
    if (!data.serverPath) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MCP_SERVER_PATH is required in stdio mode', path: ['serverPath'] });
    if (!data.jamfUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JAMF_URL is required in stdio mode', path: ['jamfUrl'] });
    if (!data.jamfClientId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JAMF_CLIENT_ID is required in stdio mode', path: ['jamfClientId'] });
    if (!data.jamfClientSecret) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JAMF_CLIENT_SECRET is required in stdio mode', path: ['jamfClientSecret'] });
  } else {
    if (!data.serverUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MCP_SERVER_URL is required in http mode', path: ['serverUrl'] });
  }
});

const configSchema = z.object({
  mcp: mcpSchema,
  bedrock: z.object({
    region: z.string().default('us-east-1'),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    model: z.string().default('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
    maxToolRounds: z.number().int().positive().default(15),
    requestTimeoutMs: z.number().int().positive().default(120_000),
  }),
  slack: z.object({
    botToken: z.string().optional(),
    channels: z.object({
      compliance: z.string().optional(),
      security: z.string().optional(),
      fleet: z.string().optional(),
    }),
    enabled: z.boolean().default(false),
  }),
  scheduler: z.object({
    enabled: z.boolean().default(false),
    timezone: z.string().default('America/New_York'),
    cron: z.object({
      compliance: z.string().default('0 8 * * 1-5'),
      security: z.string().default('0 9 * * 1-5'),
      fleet: z.string().default('0 10 * * 1'),
    }),
  }),
});

export type Config = z.infer<typeof configSchema>;

function buildEnvMap(env: Record<string, string | undefined>): Record<string, unknown> {
  return {
    mcp: {
      transport: env.MCP_TRANSPORT ?? undefined,
      serverPath: env.MCP_SERVER_PATH || undefined,
      jamfUrl: env.JAMF_URL || undefined,
      jamfClientId: env.JAMF_CLIENT_ID || undefined,
      jamfClientSecret: env.JAMF_CLIENT_SECRET || undefined,
      serverUrl: env.MCP_SERVER_URL || undefined,
      connectTimeoutMs: env.MCP_CONNECT_TIMEOUT_MS ? Number(env.MCP_CONNECT_TIMEOUT_MS) : undefined,
      toolTimeoutMs: env.MCP_TOOL_TIMEOUT_MS ? Number(env.MCP_TOOL_TIMEOUT_MS) : undefined,
      maxReconnectAttempts: env.MCP_MAX_RECONNECT_ATTEMPTS ? Number(env.MCP_MAX_RECONNECT_ATTEMPTS) : undefined,
      reconnectBaseMs: env.MCP_RECONNECT_BASE_MS ? Number(env.MCP_RECONNECT_BASE_MS) : undefined,
    },
    bedrock: {
      region: env.AWS_REGION ?? undefined,
      accessKeyId: env.AWS_ACCESS_KEY_ID || undefined,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY || undefined,
      model: env.BEDROCK_MODEL ?? undefined,
      maxToolRounds: env.BEDROCK_MAX_TOOL_ROUNDS ? Number(env.BEDROCK_MAX_TOOL_ROUNDS) : undefined,
      requestTimeoutMs: env.BEDROCK_REQUEST_TIMEOUT_MS ? Number(env.BEDROCK_REQUEST_TIMEOUT_MS) : undefined,
    },
    slack: {
      botToken: env.SLACK_BOT_TOKEN || undefined,
      channels: {
        compliance: env.SLACK_CHANNEL_COMPLIANCE || undefined,
        security: env.SLACK_CHANNEL_SECURITY || undefined,
        fleet: env.SLACK_CHANNEL_FLEET || undefined,
      },
      enabled: env.SLACK_ENABLED === 'true',
    },
    scheduler: {
      enabled: env.SCHEDULER_ENABLED === 'true',
      timezone: env.SCHEDULER_TIMEZONE ?? undefined,
      cron: {
        compliance: env.CRON_COMPLIANCE ?? undefined,
        security: env.CRON_SECURITY ?? undefined,
        fleet: env.CRON_FLEET ?? undefined,
      },
    },
  };
}

export async function loadConfig(): Promise<Config> {
  let env: Record<string, string | undefined> = { ...process.env };

  // Merge secrets from AWS Secrets Manager if configured
  const secretName = process.env.AWS_SECRET_NAME;
  if (secretName) {
    const secrets = await fetchSecrets(secretName, process.env.AWS_REGION);
    // Secrets override env vars
    env = { ...env, ...secrets };
  }

  const raw = buildEnvMap(env);

  try {
    return configSchema.parse(raw);
  } catch (err) {
    throw new ConfigError('Invalid configuration', {
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

// Synchronous version for backward compatibility (no secrets support)
export function loadConfigSync(): Config {
  const raw = buildEnvMap(process.env);

  try {
    return configSchema.parse(raw);
  } catch (err) {
    throw new ConfigError('Invalid configuration', {
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }
}
