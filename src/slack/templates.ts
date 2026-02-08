import type { AgentReport, Finding, RemediationReport, RemediationAction } from '../claude/types.js';

type Block = Record<string, unknown>;

const STATUS_EMOJI: Record<string, string> = {
  healthy: ':large_green_circle:',
  warning: ':large_yellow_circle:',
  critical: ':red_circle:',
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: ':red_circle:',
  high: ':large_orange_circle:',
  medium: ':large_yellow_circle:',
  low: ':white_circle:',
};

export function buildReportHeader(report: AgentReport, reportType: string): Block[] {
  const emoji = STATUS_EMOJI[report.overallStatus] ?? ':grey_question:';
  const title = reportType.charAt(0).toUpperCase() + reportType.slice(1);

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of report.findings) {
    severityCounts[f.severity]++;
  }

  const metricsFields = Object.entries(report.metrics).slice(0, 10).map(([k, v]) => ({
    type: 'mrkdwn',
    text: `*${k}:* ${v}`,
  }));

  const blocks: Block[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${title} Report`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Status: ${report.overallStatus.toUpperCase()}*\n\n${report.summary}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Findings:* ${report.findings.length}` },
        {
          type: 'mrkdwn',
          text: `${SEVERITY_EMOJI.critical} ${severityCounts.critical}  ${SEVERITY_EMOJI.high} ${severityCounts.high}  ${SEVERITY_EMOJI.medium} ${severityCounts.medium}  ${SEVERITY_EMOJI.low} ${severityCounts.low}`,
        },
      ],
    },
  ];

  if (metricsFields.length > 0) {
    blocks.push({ type: 'section', fields: metricsFields });
  }

  blocks.push({ type: 'divider' });

  return blocks;
}

export function buildFindingBlocks(finding: Finding): Block[] {
  const emoji = SEVERITY_EMOJI[finding.severity] ?? '';

  const deviceList =
    finding.affectedDevices.length > 0
      ? finding.affectedDevices
          .slice(0, 10)
          .map(d => `• ${d.name} (ID ${d.id}) — ${d.detail}`)
          .join('\n')
      : '_No specific devices listed._';

  const deviceSuffix =
    finding.affectedDeviceCount > 10
      ? `\n_...and ${finding.affectedDeviceCount - 10} more_`
      : '';

  const steps = finding.remediation.steps
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');

  const tags = [
    `Effort: *${finding.remediation.effort}*`,
    finding.remediation.automatable ? ':robot_face: Automatable' : ':bust_in_silhouette: Manual',
  ].join('  |  ');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *[${finding.severity.toUpperCase()}] ${finding.title}*\n_${finding.category}_\n\n${finding.description}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Affected devices (${finding.affectedDeviceCount}):*\n${deviceList}${deviceSuffix}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Remediation — ${finding.remediation.title}*\n${steps}\n\n${tags}`,
      },
    },
    { type: 'divider' },
  ];
}

const ACTION_STATUS_EMOJI: Record<string, string> = {
  success: ':white_check_mark:',
  partial: ':large_yellow_circle:',
  failed: ':red_circle:',
  skipped: ':fast_forward:',
};

export function buildRemediationHeader(report: RemediationReport): Block[] {
  const statusEmoji = report.dryRun
    ? ':memo:'
    : report.findingsFailed === 0
      ? ':white_check_mark:'
      : report.findingsSucceeded > 0
        ? ':large_yellow_circle:'
        : ':red_circle:';

  const mode = report.dryRun ? 'Dry Run' : 'Remediation';

  const blocks: Block[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${mode} Report`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusEmoji} *${mode} Complete*\n\n${report.summary}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Attempted:* ${report.findingsAttempted}` },
        { type: 'mrkdwn', text: `*Succeeded:* ${report.findingsSucceeded}` },
        { type: 'mrkdwn', text: `*Failed:* ${report.findingsFailed}` },
        { type: 'mrkdwn', text: `*Actions:* ${report.actions.length}` },
      ],
    },
    { type: 'divider' },
  ];

  return blocks;
}

export function buildRemediationActionBlocks(action: RemediationAction): Block[] {
  const emoji = ACTION_STATUS_EMOJI[action.status] ?? ':grey_question:';
  const tools = action.toolsUsed.length > 0
    ? action.toolsUsed.map(t => `\`${t}\``).join(', ')
    : '_none_';

  const blocks: Block[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *[${action.status.toUpperCase()}] ${action.findingTitle}*\n\n${action.details}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Tools:* ${tools}` },
        { type: 'mrkdwn', text: `*Devices remediated:* ${action.devicesRemediated}` },
      ],
    },
  ];

  if (action.error) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *Error:* ${action.error}`,
      },
    });
  }

  blocks.push({ type: 'divider' });

  return blocks;
}

export function buildErrorBlocks(error: string, context: string): Block[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Agent Error', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *An error occurred during ${context}:*\n\`\`\`${error}\`\`\``,
      },
    },
  ];
}
