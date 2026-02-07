import type { AgentReport, Finding } from '../claude/types.js';

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
