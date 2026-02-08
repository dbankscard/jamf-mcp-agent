#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, type Config } from '../config.js';
import { MCPClient } from '../mcp/client.js';
import { Agent } from '../claude/agent.js';
import { SlackClient } from '../slack/client.js';
import { getSystemPrompt, ReportType, getRemediationPrompt, buildRemediationUserMessage } from '../claude/prompts.js';
import { runJob } from '../scheduler/index.js';
import { startScheduler } from '../scheduler/index.js';
import { logger } from '../logger.js';
import { shutdownManager } from '../shutdown.js';
import { HealthChecker } from '../health.js';
import { recordRemediation } from '../metrics.js';
import type { AgentReport, Finding } from '../claude/types.js';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

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
  .option('--write', 'Allow the agent to use write tools (create, update, deploy)')
  .action(async (question: string, opts: { write?: boolean }) => {
    const { agent, mcp } = await boot({ readOnlyTools: !opts.write });

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

interface BootOptions {
  readOnlyTools?: boolean;
}

async function boot(options?: BootOptions): Promise<{ agent: Agent; slack: SlackClient | null; mcp: MCPClient; config: Config }> {
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

  const readOnlyTools = options?.readOnlyTools ?? true;
  if (!readOnlyTools) {
    logger.warn('Write mode enabled — agent can modify your Jamf environment');
  }

  const agent = new Agent(mcp, {
    model: config.bedrock.model,
    maxToolRounds: config.bedrock.maxToolRounds,
    region: config.bedrock.region,
    accessKeyId: config.bedrock.accessKeyId,
    secretAccessKey: config.bedrock.secretAccessKey,
    requestTimeoutMs: config.bedrock.requestTimeoutMs,
    readOnlyTools,
  });

  const slack =
    config.slack.enabled && config.slack.botToken
      ? new SlackClient(config.slack.botToken)
      : null;

  return { agent, slack, mcp, config };
}

program
  .command('remediate [type]')
  .description('Analyze and remediate findings: compliance, security, or fleet')
  .option('--file <path>', 'Load findings from a saved report JSON file')
  .option('--dry-run', 'Plan remediation without executing write tools')
  .option('--auto-approve', 'Skip interactive approval (filters by automatable findings)')
  .option('--min-severity <level>', 'Minimum severity for auto-approve (critical, high, medium, low)', 'medium')
  .option('--finding <indices>', 'Comma-separated finding indices to remediate')
  .option('--slack', 'Post remediation results to Slack')
  .action(async (type: string | undefined, opts: {
    file?: string;
    dryRun?: boolean;
    autoApprove?: boolean;
    minSeverity?: string;
    finding?: string;
    slack?: boolean;
  }) => {
    if (!type && !opts.file) {
      console.error('Provide a report type (compliance, security, fleet) or --file <path>.');
      process.exit(1);
      return;
    }

    if (type && !['compliance', 'security', 'fleet'].includes(type)) {
      console.error(`Unknown report type: ${type}. Use compliance, security, or fleet.`);
      process.exit(1);
      return;
    }

    // Phase 1: Load or generate the report
    let report: AgentReport;
    let reportType = type ?? 'compliance';

    if (opts.file) {
      report = loadReportFromFile(opts.file);
    } else {
      const { agent, mcp } = await boot();
      try {
        const result = await agent.run(getSystemPrompt(reportType as ReportType), `Run a ${reportType} check on the fleet and produce a report.`);
        if (!result.report) {
          console.error('Analysis did not produce a structured report.');
          process.exit(1);
          return;
        }
        report = result.report;
      } finally {
        await mcp.disconnect();
      }
    }

    if (report.findings.length === 0) {
      console.log(JSON.stringify({ summary: 'No findings to remediate.', actions: [], dryRun: opts.dryRun ?? false }, null, 2));
      return;
    }

    // Phase 2: Select findings
    const selectedIndices = await selectFindings(report.findings, opts);

    if (selectedIndices.length === 0) {
      console.log(JSON.stringify({ summary: 'No findings selected for remediation.', actions: [], dryRun: opts.dryRun ?? false }, null, 2));
      return;
    }

    // Phase 3: Run remediation agent
    const dryRun = opts.dryRun ?? false;
    const { agent, slack, mcp, config } = await boot({ readOnlyTools: dryRun });

    try {
      const start = Date.now();
      const systemPrompt = getRemediationPrompt(dryRun);
      const userMessage = buildRemediationUserMessage(report.findings, selectedIndices);
      const result = await agent.runRemediation(systemPrompt, userMessage);

      recordRemediation(
        Date.now() - start,
        selectedIndices.length,
        result.report?.findingsSucceeded ?? 0,
        dryRun,
      ).catch(() => {});

      if (result.report) {
        console.log(JSON.stringify(result.report, null, 2));

        if (opts.slack && slack) {
          const channelId = config.slack.channels[reportType as keyof typeof config.slack.channels] ?? '';
          await slack.postRemediationReport(channelId, result.report);
        }
      } else {
        console.log(result.rawText);
      }
    } finally {
      await mcp.disconnect();
    }
  });

function loadReportFromFile(filePath: string): AgentReport {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.summary || !parsed.overallStatus || !Array.isArray(parsed.findings)) {
    console.error('Invalid report file: missing required fields (summary, overallStatus, findings).');
    process.exit(1);
  }
  return parsed as AgentReport;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

async function selectFindings(
  findings: Finding[],
  opts: { autoApprove?: boolean; minSeverity?: string; finding?: string },
): Promise<number[]> {
  // Explicit indices
  if (opts.finding) {
    return opts.finding.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n < findings.length);
  }

  // Auto-approve: filter by automatable + min severity
  if (opts.autoApprove) {
    const minSev = SEVERITY_ORDER[opts.minSeverity ?? 'medium'] ?? 2;
    return findings
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.remediation.automatable && (SEVERITY_ORDER[f.severity] ?? 3) <= minSev)
      .map(({ i }) => i);
  }

  // Interactive: require TTY
  if (!process.stdin.isTTY) {
    console.error('Non-interactive context detected. Use --auto-approve or --finding to select findings.');
    process.exit(1);
  }

  // Display findings
  console.log('\nFindings:\n');
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const auto = f.remediation.automatable ? 'automatable' : 'manual';
    console.log(`  [${i}] [${f.severity.toUpperCase()}] ${f.title} (${f.affectedDeviceCount} device(s), ${auto})`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => {
    rl.question('\nEnter finding indices to remediate (comma-separated, or "all"): ', resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() === 'all') {
    return findings.map((_, i) => i);
  }

  return answer.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n < findings.length);
}

program.parse();
