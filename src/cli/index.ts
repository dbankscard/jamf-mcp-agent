#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, type Config } from '../config.js';
import { MCPClient } from '../mcp/client.js';
import { buildMCPOptions } from '../mcp/options.js';
import { Agent } from '../claude/agent.js';
import { SlackClient } from '../slack/client.js';
import { getSystemPrompt, ReportType, getRemediationPrompt, buildRemediationUserMessage } from '../claude/prompts.js';
import { runJob } from '../scheduler/index.js';
import { startScheduler } from '../scheduler/index.js';
import { logger } from '../logger.js';
import { shutdownManager } from '../shutdown.js';
import { HealthChecker } from '../health.js';
import { createHealthServer } from '../health-server.js';
import { preflight, logStartupBanner, loadConfigWithRetry } from '../preflight.js';
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
  .option('--save <path>', 'Save the report JSON to a file')
  .action(async (type: string, opts: { slack?: boolean; save?: string }) => {
    if (!['compliance', 'security', 'fleet'].includes(type)) {
      console.error(`Unknown report type: ${type}. Use compliance, security, or fleet.`);
      process.exit(1);
    }

    const { agent, slack, mcp, config } = await boot();

    try {
      const slackClient = opts.slack ? slack : null;
      const channelId = config.slack.channels[type as keyof typeof config.slack.channels];
      await runJob(type as ReportType, agent, slackClient, channelId, opts.save, config, mcp);
    } finally {
      await mcp.disconnect();
    }
  });

program
  .command('ask <question>')
  .description('Ask the agent an ad-hoc question about your Jamf environment')
  .option('--write', 'Allow the agent to use write tools (create, update, deploy)')
  .option('--save <path>', 'Save the response to a file')
  .action(async (question: string, opts: { write?: boolean; save?: string }) => {
    const writeMode = opts.write ?? false;
    const { agent, mcp } = await boot({ readOnlyTools: !writeMode });

    try {
      const prompt = writeMode ? getSystemPrompt('adhoc-write') : getSystemPrompt('adhoc');
      const result = await agent.run(prompt, question);
      const output = result.report
        ? JSON.stringify(result.report, null, 2)
        : result.rawText;
      console.log(output);
      if (opts.save) saveOutput(opts.save, output);
    } finally {
      await mcp.disconnect();
    }
  });

program
  .command('start')
  .description('Start in daemon mode with scheduled reports')
  .action(async () => {
    const config = await loadConfigWithRetry();
    const { agent, slack, mcp } = await boot({ config });

    await preflight({ mcp, slack, config });
    logStartupBanner(config);

    shutdownManager.onShutdown(() => mcp.disconnect());
    startScheduler({ agent, slack, config, mcp });

    const checker = new HealthChecker(mcp, config);
    const stopHealthCheck = checker.startPeriodicCheck(60_000);
    shutdownManager.onShutdown(async () => stopHealthCheck());

    const server = createHealthServer(checker, config.healthPort);
    shutdownManager.onShutdown(async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
    });

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
  config?: Config;
}

async function boot(options?: BootOptions): Promise<{ agent: Agent; slack: SlackClient | null; mcp: MCPClient; config: Config }> {
  const config = options?.config ?? await loadConfig();

  const mcp = new MCPClient(buildMCPOptions(config));

  await mcp.connect();

  const readOnlyTools = options?.readOnlyTools ?? true;
  if (!readOnlyTools) {
    logger.warn('Write mode enabled — agent can modify your Jamf environment');
  }

  const agent = new Agent(mcp, {
    model: config.bedrock.model,
    maxToolRounds: config.bedrock.maxToolRounds,
    maxTokens: config.bedrock.maxTokens,
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
  .option('--save <path>', 'Save the remediation report JSON to a file')
  .action(async (type: string | undefined, opts: {
    file?: string;
    dryRun?: boolean;
    autoApprove?: boolean;
    minSeverity?: string;
    finding?: string;
    slack?: boolean;
    save?: string;
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

    const dryRun = opts.dryRun ?? false;

    // Boot once — reuse the connection for both analysis and remediation.
    // For analysis we always use read-only; for remediation, dry-run stays read-only.
    const { agent: analysisAgent, slack, mcp, config } = opts.file
      ? await boot({ readOnlyTools: dryRun })
      : await boot();

    try {
      // Phase 1: Load or generate the report
      let report: AgentReport;
      let reportType = type ?? 'compliance';

      if (opts.file) {
        report = loadReportFromFile(opts.file);
      } else {
        const result = await analysisAgent.run(getSystemPrompt(reportType as ReportType), `Run a ${reportType} check on the fleet and produce a report.`);
        if (!result.report) {
          console.error('Analysis did not produce a structured report.');
          process.exit(1);
          return;
        }
        report = result.report;
      }

      // Print analysis summary to stderr
      process.stderr.write(`Analysis: ${report.overallStatus} — ${report.findings.length} finding(s)\n`);
      for (let i = 0; i < report.findings.length; i++) {
        process.stderr.write(printFindingSummary(report.findings[i], i) + '\n');
      }

      if (report.findings.length === 0) {
        console.log(JSON.stringify({ summary: 'No findings to remediate.', actions: [], dryRun }, null, 2));
        return;
      }

      // Phase 2: Select findings
      const selectedIndices = await selectFindings(report.findings, opts);

      // Print selection summary to stderr
      const selectedSet = new Set(selectedIndices);
      process.stderr.write(`Selected ${selectedIndices.length} of ${report.findings.length} finding(s) for remediation:\n`);
      for (let i = 0; i < report.findings.length; i++) {
        const f = report.findings[i];
        const status = selectedSet.has(i)
          ? 'selected'
          : !f.remediation.automatable
            ? 'skipped (manual)'
            : (SEVERITY_ORDER[f.severity] ?? 3) > (SEVERITY_ORDER[opts.minSeverity ?? 'medium'] ?? 2)
              ? 'skipped (below min-severity)'
              : 'skipped (not selected)';
        process.stderr.write(`  [${i}] [${f.severity.toUpperCase()}] ${f.title} (${f.affectedDeviceCount} device(s)) — ${status}\n`);
      }

      if (selectedIndices.length === 0) {
        console.log(JSON.stringify({ summary: 'No findings selected for remediation.', actions: [], dryRun }, null, 2));
        return;
      }

      // Phase 3: Run remediation agent
      // Create a new agent with write tools if this is a live run (not dry-run).
      // For dry-run, the analysis agent (read-only) is reused directly.
      const remediationAgent = dryRun
        ? analysisAgent
        : new Agent(mcp, {
            model: config.bedrock.model,
            maxToolRounds: config.bedrock.maxToolRounds,
            maxTokens: config.bedrock.maxTokens,
            region: config.bedrock.region,
            accessKeyId: config.bedrock.accessKeyId,
            secretAccessKey: config.bedrock.secretAccessKey,
            requestTimeoutMs: config.bedrock.requestTimeoutMs,
            readOnlyTools: false,
          });

      if (!dryRun) {
        logger.warn('Write mode enabled — agent can modify your Jamf environment');
      }

      const start = Date.now();
      const systemPrompt = getRemediationPrompt(dryRun);
      const userMessage = buildRemediationUserMessage(report.findings, selectedIndices, report.overallStatus);
      const result = await remediationAgent.runRemediation(systemPrompt, userMessage);

      recordRemediation(
        Date.now() - start,
        selectedIndices.length,
        result.report?.findingsSucceeded ?? 0,
        dryRun,
      ).catch(() => {});

      if (result.report) {
        const output = JSON.stringify(result.report, null, 2);
        console.log(output);
        if (opts.save) saveOutput(opts.save, output);

        if (opts.slack && slack) {
          const channelId = config.slack.channels[reportType as keyof typeof config.slack.channels] ?? '';
          await slack.postRemediationReport(channelId, result.report);
        }
      } else {
        console.log(result.rawText);
        if (opts.save) saveOutput(opts.save, result.rawText);
      }
    } finally {
      await mcp.disconnect();
    }
  });

function validateFinding(finding: any, index: number): string | null {
  if (!finding || typeof finding !== 'object') return `findings[${index}]: not an object`;
  if (typeof finding.title !== 'string') return `findings[${index}]: missing title`;
  if (!['critical', 'high', 'medium', 'low'].includes(finding.severity)) return `findings[${index}]: invalid severity "${finding.severity}"`;
  if (typeof finding.affectedDeviceCount !== 'number') return `findings[${index}]: missing affectedDeviceCount`;
  if (!Array.isArray(finding.affectedDevices)) return `findings[${index}]: missing affectedDevices array`;
  if (!finding.remediation || typeof finding.remediation !== 'object') return `findings[${index}]: missing remediation object`;
  if (typeof finding.remediation.automatable !== 'boolean') return `findings[${index}]: remediation.automatable must be a boolean`;
  return null;
}

function loadReportFromFile(filePath: string): AgentReport {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.summary || !parsed.overallStatus || !Array.isArray(parsed.findings)) {
    console.error('Invalid report file: missing required fields (summary, overallStatus, findings).');
    process.exit(1);
  }

  for (let i = 0; i < parsed.findings.length; i++) {
    const error = validateFinding(parsed.findings[i], i);
    if (error) {
      console.error(`Invalid report file: ${error}.`);
      process.exit(1);
    }
  }

  return parsed as AgentReport;
}

function saveOutput(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content + '\n', 'utf-8');
  process.stderr.write(`Saved to ${filePath}\n`);
}

function printFindingSummary(finding: Finding, index: number): string {
  const auto = finding.remediation.automatable ? 'automatable' : 'manual';
  return `  [${index}] [${finding.severity.toUpperCase()}] ${finding.title} (${finding.affectedDeviceCount} device(s), ${auto})`;
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
    console.log(printFindingSummary(findings[i], i));
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
