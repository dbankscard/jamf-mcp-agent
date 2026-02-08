import { describe, it, expect } from 'vitest';
import { buildReportHeader, buildFindingBlocks, buildErrorBlocks, buildRemediationHeader, buildRemediationActionBlocks } from './templates.js';
import type { AgentReport, Finding, AffectedDevice, RemediationReport, RemediationAction } from '../claude/types.js';

function makeDevice(n: number): AffectedDevice {
  return { name: `device-${n}`, id: `id-${n}`, detail: `detail-${n}` };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    title: 'Outdated OS',
    severity: 'high',
    category: 'compliance',
    description: 'Several devices are running an outdated OS.',
    affectedDeviceCount: 2,
    affectedDevices: [makeDevice(1), makeDevice(2)],
    remediation: {
      title: 'Update OS',
      steps: ['Open Software Update', 'Install latest version'],
      effort: 'low',
      automatable: true,
    },
    ...overrides,
  };
}

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    summary: 'Fleet is mostly healthy.',
    overallStatus: 'healthy',
    findings: [],
    metrics: {},
    ...overrides,
  };
}

describe('buildReportHeader', () => {
  it('uses green circle emoji for healthy status', () => {
    const blocks = buildReportHeader(makeReport({ overallStatus: 'healthy' }), 'security');
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':large_green_circle:');
    expect(statusBlock.text.text).toContain('HEALTHY');
  });

  it('uses yellow circle emoji for warning status', () => {
    const blocks = buildReportHeader(makeReport({ overallStatus: 'warning' }), 'security');
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':large_yellow_circle:');
    expect(statusBlock.text.text).toContain('WARNING');
  });

  it('uses red circle emoji for critical status', () => {
    const blocks = buildReportHeader(makeReport({ overallStatus: 'critical' }), 'security');
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':red_circle:');
    expect(statusBlock.text.text).toContain('CRITICAL');
  });

  it('falls back to grey question emoji for unknown status', () => {
    const report = makeReport();
    (report as any).overallStatus = 'unknown';
    const blocks = buildReportHeader(report, 'security');
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':grey_question:');
  });

  it('capitalizes the first letter of the report type in the title', () => {
    const blocks = buildReportHeader(makeReport(), 'security');
    const header = blocks[0] as Record<string, any>;
    expect(header.text.text).toBe('Security Report');
  });

  it('capitalizes single-word report type', () => {
    const blocks = buildReportHeader(makeReport(), 'compliance');
    const header = blocks[0] as Record<string, any>;
    expect(header.text.text).toBe('Compliance Report');
  });

  it('includes summary text in the status section', () => {
    const blocks = buildReportHeader(makeReport({ summary: 'All good.' }), 'security');
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain('All good.');
  });

  it('counts severity levels across findings', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'low' }),
      makeFinding({ severity: 'low' }),
    ];
    const blocks = buildReportHeader(makeReport({ findings }), 'security');
    const countsBlock = blocks[2] as Record<string, any>;

    // The findings count field
    expect(countsBlock.fields[0].text).toBe('*Findings:* 6');

    // The severity breakdown field
    const severityText = countsBlock.fields[1].text as string;
    expect(severityText).toContain(':red_circle: 2');
    expect(severityText).toContain(':large_orange_circle: 1');
    expect(severityText).toContain(':large_yellow_circle: 1');
    expect(severityText).toContain(':white_circle: 2');
  });

  it('shows zero counts when findings array is empty', () => {
    const blocks = buildReportHeader(makeReport({ findings: [] }), 'security');
    const countsBlock = blocks[2] as Record<string, any>;

    expect(countsBlock.fields[0].text).toBe('*Findings:* 0');

    const severityText = countsBlock.fields[1].text as string;
    expect(severityText).toContain(':red_circle: 0');
    expect(severityText).toContain(':large_orange_circle: 0');
    expect(severityText).toContain(':large_yellow_circle: 0');
    expect(severityText).toContain(':white_circle: 0');
  });

  it('displays metrics as fields when present', () => {
    const metrics = { totalDevices: 100, compliant: 95 };
    const blocks = buildReportHeader(makeReport({ metrics }), 'security');

    // header, status, findings, metrics, divider
    expect(blocks).toHaveLength(5);
    const metricsBlock = blocks[3] as Record<string, any>;
    expect(metricsBlock.type).toBe('section');
    expect(metricsBlock.fields).toHaveLength(2);
    expect(metricsBlock.fields[0].text).toBe('*totalDevices:* 100');
    expect(metricsBlock.fields[1].text).toBe('*compliant:* 95');
  });

  it('limits metrics to 10 fields', () => {
    const metrics: Record<string, number> = {};
    for (let i = 0; i < 15; i++) {
      metrics[`metric${i}`] = i;
    }
    const blocks = buildReportHeader(makeReport({ metrics }), 'security');
    const metricsBlock = blocks[3] as Record<string, any>;
    expect(metricsBlock.fields).toHaveLength(10);
  });

  it('omits metrics section when metrics is empty', () => {
    const blocks = buildReportHeader(makeReport({ metrics: {} }), 'security');
    // header, status, findings, divider — no metrics section
    expect(blocks).toHaveLength(4);
    expect(blocks[3]).toEqual({ type: 'divider' });
  });

  it('always ends with a divider block', () => {
    const blocks = buildReportHeader(makeReport(), 'security');
    expect(blocks[blocks.length - 1]).toEqual({ type: 'divider' });
  });
});

describe('buildFindingBlocks', () => {
  it('maps critical severity to red circle emoji', () => {
    const blocks = buildFindingBlocks(makeFinding({ severity: 'critical' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':red_circle:');
    expect(section.text.text).toContain('[CRITICAL]');
  });

  it('maps high severity to orange circle emoji', () => {
    const blocks = buildFindingBlocks(makeFinding({ severity: 'high' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':large_orange_circle:');
    expect(section.text.text).toContain('[HIGH]');
  });

  it('maps medium severity to yellow circle emoji', () => {
    const blocks = buildFindingBlocks(makeFinding({ severity: 'medium' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':large_yellow_circle:');
    expect(section.text.text).toContain('[MEDIUM]');
  });

  it('maps low severity to white circle emoji', () => {
    const blocks = buildFindingBlocks(makeFinding({ severity: 'low' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':white_circle:');
    expect(section.text.text).toContain('[LOW]');
  });

  it('falls back to empty string for unknown severity emoji', () => {
    const finding = makeFinding();
    (finding as any).severity = 'info';
    const blocks = buildFindingBlocks(finding);
    const section = blocks[0] as Record<string, any>;
    // Should start with a space then asterisk (no emoji prefix)
    expect(section.text.text).toMatch(/^\s?\*\[INFO\]/);
  });

  it('includes title, category, and description in first block', () => {
    const finding = makeFinding({
      title: 'Missing Encryption',
      category: 'security',
      description: 'FileVault is disabled.',
    });
    const blocks = buildFindingBlocks(finding);
    const text = (blocks[0] as Record<string, any>).text.text;
    expect(text).toContain('Missing Encryption');
    expect(text).toContain('_security_');
    expect(text).toContain('FileVault is disabled.');
  });

  it('formats device list with name, ID, and detail', () => {
    const devices = [makeDevice(1), makeDevice(2)];
    const blocks = buildFindingBlocks(makeFinding({
      affectedDeviceCount: 2,
      affectedDevices: devices,
    }));
    const devicesText = (blocks[1] as Record<string, any>).text.text;
    expect(devicesText).toContain('device-1 (ID id-1) — detail-1');
    expect(devicesText).toContain('device-2 (ID id-2) — detail-2');
  });

  it('shows affected device count in the header', () => {
    const blocks = buildFindingBlocks(makeFinding({ affectedDeviceCount: 42 }));
    const devicesText = (blocks[1] as Record<string, any>).text.text;
    expect(devicesText).toContain('*Affected devices (42):*');
  });

  it('shows ellipsis when more than 10 devices are affected', () => {
    const devices = Array.from({ length: 12 }, (_, i) => makeDevice(i));
    const blocks = buildFindingBlocks(makeFinding({
      affectedDeviceCount: 12,
      affectedDevices: devices,
    }));
    const devicesText = (blocks[1] as Record<string, any>).text.text;

    // Only first 10 devices shown
    expect(devicesText).toContain('device-9');
    expect(devicesText).not.toContain('device-10');
    expect(devicesText).not.toContain('device-11');

    // Ellipsis with remaining count
    expect(devicesText).toContain('...and 2 more');
  });

  it('does not show ellipsis when exactly 10 devices', () => {
    const devices = Array.from({ length: 10 }, (_, i) => makeDevice(i));
    const blocks = buildFindingBlocks(makeFinding({
      affectedDeviceCount: 10,
      affectedDevices: devices,
    }));
    const devicesText = (blocks[1] as Record<string, any>).text.text;
    expect(devicesText).not.toContain('...and');
  });

  it('shows fallback text when device list is empty', () => {
    const blocks = buildFindingBlocks(makeFinding({
      affectedDeviceCount: 0,
      affectedDevices: [],
    }));
    const devicesText = (blocks[1] as Record<string, any>).text.text;
    expect(devicesText).toContain('_No specific devices listed._');
  });

  it('formats remediation steps as numbered list', () => {
    const blocks = buildFindingBlocks(makeFinding({
      remediation: {
        title: 'Fix it',
        steps: ['Step A', 'Step B', 'Step C'],
        effort: 'medium',
        automatable: false,
      },
    }));
    const remediationText = (blocks[2] as Record<string, any>).text.text;
    expect(remediationText).toContain('1. Step A');
    expect(remediationText).toContain('2. Step B');
    expect(remediationText).toContain('3. Step C');
  });

  it('includes remediation title', () => {
    const blocks = buildFindingBlocks(makeFinding({
      remediation: {
        title: 'Enable FileVault',
        steps: ['Do it'],
        effort: 'low',
        automatable: true,
      },
    }));
    const remediationText = (blocks[2] as Record<string, any>).text.text;
    expect(remediationText).toContain('*Remediation — Enable FileVault*');
  });

  it('displays effort tag', () => {
    const blocks = buildFindingBlocks(makeFinding({
      remediation: {
        title: 'Fix',
        steps: ['Do'],
        effort: 'high',
        automatable: true,
      },
    }));
    const remediationText = (blocks[2] as Record<string, any>).text.text;
    expect(remediationText).toContain('Effort: *high*');
  });

  it('shows automatable tag when true', () => {
    const blocks = buildFindingBlocks(makeFinding({
      remediation: {
        title: 'Fix',
        steps: ['Do'],
        effort: 'low',
        automatable: true,
      },
    }));
    const remediationText = (blocks[2] as Record<string, any>).text.text;
    expect(remediationText).toContain(':robot_face: Automatable');
    expect(remediationText).not.toContain(':bust_in_silhouette: Manual');
  });

  it('shows manual tag when not automatable', () => {
    const blocks = buildFindingBlocks(makeFinding({
      remediation: {
        title: 'Fix',
        steps: ['Do'],
        effort: 'low',
        automatable: false,
      },
    }));
    const remediationText = (blocks[2] as Record<string, any>).text.text;
    expect(remediationText).toContain(':bust_in_silhouette: Manual');
    expect(remediationText).not.toContain(':robot_face: Automatable');
  });

  it('always ends with a divider block', () => {
    const blocks = buildFindingBlocks(makeFinding());
    expect(blocks[blocks.length - 1]).toEqual({ type: 'divider' });
  });
});

function makeRemediationReport(overrides: Partial<RemediationReport> = {}): RemediationReport {
  return {
    summary: 'Remediated 2 findings successfully.',
    originalReportStatus: 'warning',
    findingsAttempted: 2,
    findingsSucceeded: 2,
    findingsFailed: 0,
    actions: [],
    dryRun: false,
    ...overrides,
  };
}

function makeRemediationAction(overrides: Partial<RemediationAction> = {}): RemediationAction {
  return {
    findingIndex: 0,
    findingTitle: 'Outdated OS',
    action: 'Created software update plan',
    toolsUsed: ['createSoftwareUpdatePlan'],
    status: 'success',
    devicesRemediated: 5,
    details: 'Scheduled updates for 5 devices.',
    ...overrides,
  };
}

describe('buildRemediationHeader', () => {
  it('shows checkmark for all-success report', () => {
    const blocks = buildRemediationHeader(makeRemediationReport({ findingsFailed: 0 }));
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':white_check_mark:');
  });

  it('shows yellow for partial success', () => {
    const blocks = buildRemediationHeader(makeRemediationReport({ findingsSucceeded: 1, findingsFailed: 1 }));
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':large_yellow_circle:');
  });

  it('shows red for all-failed', () => {
    const blocks = buildRemediationHeader(makeRemediationReport({ findingsSucceeded: 0, findingsFailed: 2 }));
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':red_circle:');
  });

  it('shows memo for dry-run', () => {
    const blocks = buildRemediationHeader(makeRemediationReport({ dryRun: true }));
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain(':memo:');
    expect(statusBlock.text.text).toContain('Dry Run');
  });

  it('includes title with "Remediation Report"', () => {
    const blocks = buildRemediationHeader(makeRemediationReport());
    const header = blocks[0] as Record<string, any>;
    expect(header.text.text).toBe('Remediation Report');
  });

  it('includes title with "Dry Run Report" for dry-run', () => {
    const blocks = buildRemediationHeader(makeRemediationReport({ dryRun: true }));
    const header = blocks[0] as Record<string, any>;
    expect(header.text.text).toBe('Dry Run Report');
  });

  it('includes summary text', () => {
    const blocks = buildRemediationHeader(makeRemediationReport({ summary: 'All done.' }));
    const statusBlock = blocks[1] as Record<string, any>;
    expect(statusBlock.text.text).toContain('All done.');
  });

  it('includes counts in fields', () => {
    const report = makeRemediationReport({
      findingsAttempted: 3,
      findingsSucceeded: 2,
      findingsFailed: 1,
      actions: [makeRemediationAction(), makeRemediationAction()],
    });
    const blocks = buildRemediationHeader(report);
    const countsBlock = blocks[2] as Record<string, any>;
    expect(countsBlock.fields[0].text).toContain('3');
    expect(countsBlock.fields[1].text).toContain('2');
    expect(countsBlock.fields[2].text).toContain('1');
    expect(countsBlock.fields[3].text).toContain('2');
  });

  it('ends with a divider', () => {
    const blocks = buildRemediationHeader(makeRemediationReport());
    expect(blocks[blocks.length - 1]).toEqual({ type: 'divider' });
  });
});

describe('buildRemediationActionBlocks', () => {
  it('shows checkmark for success', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ status: 'success' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':white_check_mark:');
    expect(section.text.text).toContain('[SUCCESS]');
  });

  it('shows yellow for partial', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ status: 'partial' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':large_yellow_circle:');
  });

  it('shows red for failed', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ status: 'failed' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':red_circle:');
  });

  it('shows fast_forward for skipped', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ status: 'skipped' }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain(':fast_forward:');
  });

  it('includes finding title and details', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({
      findingTitle: 'Missing Encryption',
      details: 'Deployed FileVault profile.',
    }));
    const section = blocks[0] as Record<string, any>;
    expect(section.text.text).toContain('Missing Encryption');
    expect(section.text.text).toContain('Deployed FileVault profile.');
  });

  it('formats tools as code blocks', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({
      toolsUsed: ['executePolicy', 'sendComputerMDMCommand'],
    }));
    const fieldsBlock = blocks[1] as Record<string, any>;
    expect(fieldsBlock.fields[0].text).toContain('`executePolicy`');
    expect(fieldsBlock.fields[0].text).toContain('`sendComputerMDMCommand`');
  });

  it('shows "_none_" when no tools used', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ toolsUsed: [] }));
    const fieldsBlock = blocks[1] as Record<string, any>;
    expect(fieldsBlock.fields[0].text).toContain('_none_');
  });

  it('shows devices remediated count', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ devicesRemediated: 42 }));
    const fieldsBlock = blocks[1] as Record<string, any>;
    expect(fieldsBlock.fields[1].text).toContain('42');
  });

  it('includes error block when error is present', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({
      status: 'failed',
      error: 'Policy not found',
    }));
    const errorBlock = blocks[2] as Record<string, any>;
    expect(errorBlock.text.text).toContain(':warning:');
    expect(errorBlock.text.text).toContain('Policy not found');
  });

  it('does not include error block when no error', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction({ error: undefined }));
    // Should be: section, fields, divider (3 blocks, no error block)
    expect(blocks).toHaveLength(3);
  });

  it('ends with a divider', () => {
    const blocks = buildRemediationActionBlocks(makeRemediationAction());
    expect(blocks[blocks.length - 1]).toEqual({ type: 'divider' });
  });
});

describe('buildErrorBlocks', () => {
  it('returns a header and a section block', () => {
    const blocks = buildErrorBlocks('timeout', 'scheduled scan');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Agent Error', emoji: true },
    });
  });

  it('includes the error message in a code block', () => {
    const blocks = buildErrorBlocks('Connection refused', 'API call');
    const section = blocks[1] as Record<string, any>;
    expect(section.text.text).toContain('```Connection refused```');
  });

  it('includes the context in the message', () => {
    const blocks = buildErrorBlocks('fail', 'compliance check');
    const section = blocks[1] as Record<string, any>;
    expect(section.text.text).toContain('during compliance check');
  });

  it('includes a warning emoji', () => {
    const blocks = buildErrorBlocks('err', 'ctx');
    const section = blocks[1] as Record<string, any>;
    expect(section.text.text).toContain(':warning:');
  });
});
