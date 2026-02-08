import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Module-level mock fns (hoisted above vi.mock) ──────────────────────

const mockLoadConfig = vi.fn();
const mockMCPConnect = vi.fn();
const mockMCPDisconnect = vi.fn();
const mockAgentRun = vi.fn();
const mockAgentRunRemediation = vi.fn();
const mockRunJob = vi.fn();
const mockStartScheduler = vi.fn();
const mockOnShutdown = vi.fn();
const mockInstall = vi.fn();
const mockGetHealthStatus = vi.fn();
const mockPostRemediationReport = vi.fn();
const mockRecordRemediation = vi.fn();

// ── Track Commander action handlers ────────────────────────────────────

type ActionHandler = (...args: any[]) => Promise<void>;
const capturedActions: Record<string, ActionHandler> = {};
let parseCalled = false;

vi.mock('commander', () => {
  const chainable = () => programProxy;
  const programProxy: Record<string, any> = {
    name: chainable,
    description: chainable,
    version: chainable,
    option: chainable,
    command(name: string) {
      programProxy._currentCmd = name.split(' ')[0];
      return programProxy;
    },
    action(fn: ActionHandler) {
      capturedActions[programProxy._currentCmd] = fn;
      return programProxy;
    },
    parse() {
      parseCalled = true;
    },
    _currentCmd: '',
  };

  return { Command: class { constructor() { return programProxy; } } };
});

// ── Mock dependencies ──────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  loadConfig: (...args: any[]) => mockLoadConfig(...args),
}));

vi.mock('../mcp/client.js', () => ({
  MCPClient: class {
    constructor() {}
    connect = mockMCPConnect;
    disconnect = mockMCPDisconnect;
    isConnected = vi.fn(() => true);
    getToolCount = vi.fn(() => 50);
  },
}));

vi.mock('../claude/agent.js', () => ({
  Agent: class {
    constructor() {}
    run = mockAgentRun;
    runRemediation = mockAgentRunRemediation;
  },
}));

vi.mock('../slack/client.js', () => ({
  SlackClient: class {
    constructor() {}
    postReport = vi.fn();
    postError = vi.fn();
    postRemediationReport = mockPostRemediationReport;
  },
}));

vi.mock('../claude/prompts.js', () => ({
  getSystemPrompt: vi.fn((type: string) => `system-prompt-for-${type}`),
  getUserMessage: vi.fn((type: string) => `user-message-for-${type}`),
  getRemediationPrompt: vi.fn((dryRun: boolean) => `remediation-prompt-dryrun-${dryRun}`),
  buildRemediationUserMessage: vi.fn(() => 'remediation-user-message'),
}));

vi.mock('../scheduler/index.js', () => ({
  runJob: (...args: any[]) => mockRunJob(...args),
  startScheduler: (...args: any[]) => mockStartScheduler(...args),
}));

vi.mock('../shutdown.js', () => ({
  shutdownManager: {
    onShutdown: (...args: any[]) => mockOnShutdown(...args),
    install: (...args: any[]) => mockInstall(...args),
  },
}));

vi.mock('../health.js', () => ({
  HealthChecker: class {
    constructor() {}
    getHealthStatus = mockGetHealthStatus;
    startPeriodicCheck = vi.fn(() => vi.fn());
  },
}));

vi.mock('../metrics.js', () => ({
  recordRemediation: (...args: any[]) => mockRecordRemediation(...args),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeConfig(overrides?: Record<string, any>) {
  return {
    mcp: {
      transport: 'http',
      serverUrl: 'http://localhost:3001/mcp',
      connectTimeoutMs: 30000,
      toolTimeoutMs: 120000,
      maxReconnectAttempts: 5,
      reconnectBaseMs: 1000,
    },
    bedrock: {
      region: 'us-east-1',
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      maxToolRounds: 15,
      requestTimeoutMs: 120000,
    },
    slack: {
      enabled: false,
      botToken: undefined,
      channels: {
        compliance: 'C-COMP',
        security: 'C-SEC',
        fleet: 'C-FLEET',
      },
    },
    scheduler: {
      enabled: false,
      timezone: 'America/New_York',
      cron: {
        compliance: '0 8 * * 1-5',
        security: '0 9 * * 1-5',
        fleet: '0 10 * * 1',
      },
    },
    ...overrides,
  };
}

function makeStdioConfig() {
  return makeConfig({
    mcp: {
      transport: 'stdio',
      serverPath: '/path/to/server.js',
      jamfUrl: 'https://jamf.example.com',
      jamfClientId: 'client-id',
      jamfClientSecret: 'client-secret',
      connectTimeoutMs: 30000,
      toolTimeoutMs: 120000,
      maxReconnectAttempts: 5,
      reconnectBaseMs: 1000,
    },
  });
}

function makeSlackEnabledConfig() {
  return makeConfig({
    slack: {
      enabled: true,
      botToken: 'xoxb-test-token',
      channels: {
        compliance: 'C-COMP',
        security: 'C-SEC',
        fleet: 'C-FLEET',
      },
    },
  });
}

// ── Import the module under test once (triggers command registration) ──

beforeAll(async () => {
  await import('./index.js');
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('CLI module', () => {
  it('registers expected commands and calls parse', () => {
    expect(capturedActions).toHaveProperty('check');
    expect(capturedActions).toHaveProperty('ask');
    expect(capturedActions).toHaveProperty('start');
    expect(capturedActions).toHaveProperty('health');
    expect(capturedActions).toHaveProperty('remediate');
    expect(parseCalled).toBe(true);
  });
});

describe('boot() via commands', () => {
  it('uses HTTP transport options when config.mcp.transport is http', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockResolvedValue({ report: null, rawText: 'hello', toolCallCount: 0, rounds: 1 });

    await capturedActions.ask('test question', {});

    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
    expect(mockMCPConnect).toHaveBeenCalledTimes(1);
  });

  it('uses stdio transport options when config.mcp.transport is stdio', async () => {
    const config = makeStdioConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockResolvedValue({ report: null, rawText: 'hello', toolCallCount: 0, rounds: 1 });

    await capturedActions.ask('test question', {});

    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
    expect(mockMCPConnect).toHaveBeenCalledTimes(1);
  });

  it('creates SlackClient when slack is enabled with botToken', async () => {
    const config = makeSlackEnabledConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check('compliance', { slack: true });

    expect(mockRunJob).toHaveBeenCalledTimes(1);
    const slackArg = mockRunJob.mock.calls[0][2];
    expect(slackArg).not.toBeNull();
  });

  it('returns null for slack when slack is disabled', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check('compliance', {});

    expect(mockRunJob).toHaveBeenCalledTimes(1);
    const slackArg = mockRunJob.mock.calls[0][2];
    expect(slackArg).toBeNull();
  });
});

describe('check command', () => {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    mockExit.mockClear();
    mockConsoleError.mockClear();
  });

  it('exits with error for invalid report type', async () => {
    await capturedActions.check('invalid-type', {});

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Unknown report type: invalid-type'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it.each(['compliance', 'security', 'fleet'])('accepts valid report type: %s', async (type) => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check(type, {});

    expect(mockRunJob).toHaveBeenCalledTimes(1);
    expect(mockRunJob.mock.calls[0][0]).toBe(type);
  });

  it('passes correct channelId from config for each report type', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check('security', {});

    expect(mockRunJob.mock.calls[0][3]).toBe('C-SEC');
  });

  it('passes slack client when --slack flag is set and slack enabled', async () => {
    const config = makeSlackEnabledConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check('compliance', { slack: true });

    const slackArg = mockRunJob.mock.calls[0][2];
    expect(slackArg).not.toBeNull();
  });

  it('passes null slack when --slack flag is not set even if slack enabled', async () => {
    const config = makeSlackEnabledConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check('compliance', {});

    const slackArg = mockRunJob.mock.calls[0][2];
    expect(slackArg).toBeNull();
  });

  it('disconnects MCP in finally block after success', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockResolvedValue(undefined);

    await capturedActions.check('compliance', {});

    expect(mockMCPDisconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects MCP in finally block after runJob error', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockRunJob.mockRejectedValue(new Error('runJob boom'));

    await expect(capturedActions.check('compliance', {})).rejects.toThrow('runJob boom');

    expect(mockMCPDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe('ask command', () => {
  const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    mockConsoleLog.mockClear();
  });

  it('outputs JSON report when result.report is truthy', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const report = { summary: 'ok', overallStatus: 'healthy', findings: [], metrics: {} };
    mockAgentRun.mockResolvedValue({ report, rawText: '{}', toolCallCount: 1, rounds: 1 });

    await capturedActions.ask('what is the fleet status?', {});

    expect(mockAgentRun).toHaveBeenCalledWith(
      'system-prompt-for-adhoc',
      'what is the fleet status?',
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
  });

  it('outputs rawText when result.report is null', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    mockAgentRun.mockResolvedValue({ report: null, rawText: 'plain answer', toolCallCount: 0, rounds: 1 });

    await capturedActions.ask('how many devices?', {});

    expect(mockConsoleLog).toHaveBeenCalledWith('plain answer');
  });

  it('disconnects MCP in finally block after success', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockResolvedValue({ report: null, rawText: 'ok', toolCallCount: 0, rounds: 1 });

    await capturedActions.ask('test', {});

    expect(mockMCPDisconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects MCP in finally block after agent error', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockRejectedValue(new Error('agent boom'));

    await expect(capturedActions.ask('test', {})).rejects.toThrow('agent boom');

    expect(mockMCPDisconnect).toHaveBeenCalledTimes(1);
  });

  it('boots in read-only mode by default (no --write flag)', async () => {
    const { logger } = await import('../logger.js');
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockResolvedValue({ report: null, rawText: 'ok', toolCallCount: 0, rounds: 1 });

    await capturedActions.ask('test', {});

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('boots in write mode with --write flag and logs warning', async () => {
    const { logger } = await import('../logger.js');
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockResolvedValue({ report: null, rawText: 'ok', toolCallCount: 0, rounds: 1 });

    await capturedActions.ask('test', { write: true });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Write mode enabled'),
    );
  });
});

describe('health command', () => {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    mockExit.mockClear();
    mockConsoleLog.mockClear();
  });

  it('outputs health status JSON and exits 0 when healthy', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const healthStatus = {
      status: 'healthy',
      components: {
        mcp: { status: 'healthy', message: 'Connected, 50 tools' },
        bedrock: { status: 'healthy', message: 'Model configured' },
        slack: { status: 'healthy', message: 'Slack disabled' },
        scheduler: { status: 'healthy', message: 'Scheduler disabled' },
      },
      timestamp: new Date().toISOString(),
    };
    mockGetHealthStatus.mockResolvedValue(healthStatus);

    await capturedActions.health();

    expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(healthStatus, null, 2));
    expect(mockMCPDisconnect).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when health status is unhealthy', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const healthStatus = {
      status: 'unhealthy',
      components: {
        mcp: { status: 'unhealthy', message: 'MCP not connected' },
        bedrock: { status: 'healthy', message: 'Model configured' },
        slack: { status: 'healthy', message: 'Slack disabled' },
        scheduler: { status: 'healthy', message: 'Scheduler disabled' },
      },
      timestamp: new Date().toISOString(),
    };
    mockGetHealthStatus.mockResolvedValue(healthStatus);

    await capturedActions.health();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('handles MCP boot failure gracefully and still runs health check', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockRejectedValue(new Error('MCP connection refused'));

    const healthStatus = {
      status: 'unhealthy',
      components: {
        mcp: { status: 'unhealthy', message: 'MCP client not initialized' },
        bedrock: { status: 'healthy', message: 'Model configured' },
        slack: { status: 'healthy', message: 'Slack disabled' },
        scheduler: { status: 'healthy', message: 'Scheduler disabled' },
      },
      timestamp: new Date().toISOString(),
    };
    mockGetHealthStatus.mockResolvedValue(healthStatus);

    await capturedActions.health();

    expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(healthStatus, null, 2));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not call mcp.disconnect when boot fails', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockRejectedValue(new Error('MCP connection refused'));

    const healthStatus = {
      status: 'unhealthy',
      components: {
        mcp: { status: 'unhealthy', message: 'MCP client not initialized' },
        bedrock: { status: 'healthy', message: 'Model configured' },
        slack: { status: 'healthy', message: 'Slack disabled' },
        scheduler: { status: 'healthy', message: 'Scheduler disabled' },
      },
      timestamp: new Date().toISOString(),
    };
    mockGetHealthStatus.mockResolvedValue(healthStatus);

    await capturedActions.health();

    // boot() threw, so mcp stays null in the health action -- disconnect should not be called
    expect(mockMCPDisconnect).not.toHaveBeenCalled();
  });
});

describe('remediate command', () => {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  const mockStderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  beforeEach(() => {
    mockExit.mockClear();
    mockConsoleError.mockClear();
    mockConsoleLog.mockClear();
    mockStderrWrite.mockClear();
    mockRecordRemediation.mockResolvedValue(undefined);
  });

  it('registers remediate command', () => {
    expect(capturedActions).toHaveProperty('remediate');
  });

  it('exits with error when no type and no --file', async () => {
    await capturedActions.remediate(undefined, {});

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Provide a report type'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits with error for invalid report type', async () => {
    await capturedActions.remediate('invalid', {});

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Unknown report type: invalid'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('outputs no-findings message when report has empty findings', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockAgentRun.mockResolvedValue({
      report: {
        summary: 'All good',
        overallStatus: 'healthy',
        findings: [],
        metrics: {},
      },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    await capturedActions.remediate('compliance', { autoApprove: true });

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No findings to remediate'),
    );
  });

  it('runs dry-run remediation with auto-approve', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const finding = {
      title: 'Outdated OS',
      severity: 'high',
      category: 'compliance',
      description: 'Old OS',
      affectedDeviceCount: 3,
      affectedDevices: [],
      remediation: { title: 'Update', steps: ['update'], effort: 'low', automatable: true },
    };

    // First boot: analysis
    mockAgentRun.mockResolvedValue({
      report: {
        summary: 'Issues found',
        overallStatus: 'warning',
        findings: [finding],
        metrics: {},
      },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    // Second boot: remediation
    const remReport = {
      summary: 'Would remediate 1 finding',
      originalReportStatus: 'warning',
      findingsAttempted: 1,
      findingsSucceeded: 1,
      findingsFailed: 0,
      actions: [],
      dryRun: true,
    };
    mockAgentRunRemediation.mockResolvedValue({
      report: remReport,
      rawText: JSON.stringify(remReport),
      toolCallCount: 0,
      rounds: 1,
    });

    await capturedActions.remediate('compliance', { dryRun: true, autoApprove: true });

    expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(remReport, null, 2));
    expect(mockMCPDisconnect).toHaveBeenCalled();
  });

  it('filters findings by --finding indices', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const findings = [
      {
        title: 'Finding A',
        severity: 'critical',
        category: 'security',
        description: 'desc',
        affectedDeviceCount: 1,
        affectedDevices: [],
        remediation: { title: 'Fix A', steps: [], effort: 'low', automatable: true },
      },
      {
        title: 'Finding B',
        severity: 'low',
        category: 'compliance',
        description: 'desc',
        affectedDeviceCount: 1,
        affectedDevices: [],
        remediation: { title: 'Fix B', steps: [], effort: 'low', automatable: false },
      },
    ];

    mockAgentRun.mockResolvedValue({
      report: {
        summary: 'Issues',
        overallStatus: 'critical',
        findings,
        metrics: {},
      },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    const remReport = {
      summary: 'Fixed',
      originalReportStatus: 'critical',
      findingsAttempted: 1,
      findingsSucceeded: 1,
      findingsFailed: 0,
      actions: [],
      dryRun: false,
    };
    mockAgentRunRemediation.mockResolvedValue({
      report: remReport,
      rawText: JSON.stringify(remReport),
      toolCallCount: 1,
      rounds: 1,
    });

    await capturedActions.remediate('security', { finding: '0' });

    expect(mockAgentRunRemediation).toHaveBeenCalledTimes(1);
    expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(remReport, null, 2));
  });

  it('auto-approve filters by severity and automatable', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const findings = [
      {
        title: 'Critical Auto',
        severity: 'critical',
        category: 'security',
        description: 'desc',
        affectedDeviceCount: 1,
        affectedDevices: [],
        remediation: { title: 'Fix', steps: [], effort: 'low', automatable: true },
      },
      {
        title: 'Low Manual',
        severity: 'low',
        category: 'compliance',
        description: 'desc',
        affectedDeviceCount: 1,
        affectedDevices: [],
        remediation: { title: 'Fix', steps: [], effort: 'low', automatable: false },
      },
    ];

    mockAgentRun.mockResolvedValue({
      report: {
        summary: 'Issues',
        overallStatus: 'critical',
        findings,
        metrics: {},
      },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    const remReport = {
      summary: 'Fixed',
      originalReportStatus: 'critical',
      findingsAttempted: 1,
      findingsSucceeded: 1,
      findingsFailed: 0,
      actions: [],
      dryRun: false,
    };
    mockAgentRunRemediation.mockResolvedValue({
      report: remReport,
      rawText: JSON.stringify(remReport),
      toolCallCount: 1,
      rounds: 1,
    });

    // Only critical severity, auto-approve — should pick index 0 (critical + automatable)
    await capturedActions.remediate('security', { autoApprove: true, minSeverity: 'critical' });

    expect(mockAgentRunRemediation).toHaveBeenCalledTimes(1);
  });

  it('outputs rawText when remediation report is null', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    mockAgentRun.mockResolvedValue({
      report: {
        summary: 'Issues',
        overallStatus: 'warning',
        findings: [{
          title: 'Issue',
          severity: 'high',
          category: 'compliance',
          description: 'desc',
          affectedDeviceCount: 1,
          affectedDevices: [],
          remediation: { title: 'Fix', steps: [], effort: 'low', automatable: true },
        }],
        metrics: {},
      },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    mockAgentRunRemediation.mockResolvedValue({
      report: null,
      rawText: 'plain text result',
      toolCallCount: 0,
      rounds: 1,
    });

    await capturedActions.remediate('compliance', { autoApprove: true });

    expect(mockConsoleLog).toHaveBeenCalledWith('plain text result');
  });

  it('prints analysis summary to stderr after Phase 1', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const findings = [
      {
        title: 'Unencrypted Disks',
        severity: 'critical',
        category: 'security',
        description: 'desc',
        affectedDeviceCount: 5,
        affectedDevices: [],
        remediation: { title: 'Encrypt', steps: [], effort: 'medium', automatable: true },
      },
      {
        title: 'Outdated OS',
        severity: 'high',
        category: 'compliance',
        description: 'desc',
        affectedDeviceCount: 3,
        affectedDevices: [],
        remediation: { title: 'Update', steps: [], effort: 'low', automatable: false },
      },
    ];

    mockAgentRun.mockResolvedValue({
      report: { summary: 'Issues', overallStatus: 'warning', findings, metrics: {} },
      rawText: '{}',
      toolCallCount: 2,
      rounds: 2,
    });

    const remReport = {
      summary: 'Fixed 1',
      originalReportStatus: 'warning',
      findingsAttempted: 1,
      findingsSucceeded: 1,
      findingsFailed: 0,
      actions: [],
      dryRun: true,
    };
    mockAgentRunRemediation.mockResolvedValue({
      report: remReport,
      rawText: JSON.stringify(remReport),
      toolCallCount: 0,
      rounds: 1,
    });

    await capturedActions.remediate('security', { dryRun: true, autoApprove: true });

    const stderrOutput = mockStderrWrite.mock.calls.map(c => c[0]).join('');
    // Analysis summary
    expect(stderrOutput).toContain('Analysis: warning');
    expect(stderrOutput).toContain('2 finding(s)');
    expect(stderrOutput).toContain('[CRITICAL] Unencrypted Disks');
    expect(stderrOutput).toContain('[HIGH] Outdated OS');
  });

  it('prints selection summary with skip reasons to stderr', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const findings = [
      {
        title: 'Automatable Issue',
        severity: 'critical',
        category: 'security',
        description: 'desc',
        affectedDeviceCount: 5,
        affectedDevices: [],
        remediation: { title: 'Fix', steps: [], effort: 'low', automatable: true },
      },
      {
        title: 'Manual Issue',
        severity: 'high',
        category: 'compliance',
        description: 'desc',
        affectedDeviceCount: 3,
        affectedDevices: [],
        remediation: { title: 'Fix', steps: [], effort: 'high', automatable: false },
      },
    ];

    mockAgentRun.mockResolvedValue({
      report: { summary: 'Issues', overallStatus: 'critical', findings, metrics: {} },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    const remReport = {
      summary: 'Fixed',
      originalReportStatus: 'critical',
      findingsAttempted: 1,
      findingsSucceeded: 1,
      findingsFailed: 0,
      actions: [],
      dryRun: false,
    };
    mockAgentRunRemediation.mockResolvedValue({
      report: remReport,
      rawText: JSON.stringify(remReport),
      toolCallCount: 1,
      rounds: 1,
    });

    await capturedActions.remediate('security', { autoApprove: true });

    const stderrOutput = mockStderrWrite.mock.calls.map(c => c[0]).join('');
    // Selection summary
    expect(stderrOutput).toContain('Selected 1 of 2 finding(s) for remediation');
    expect(stderrOutput).toContain('Automatable Issue');
    expect(stderrOutput).toContain('selected');
    expect(stderrOutput).toContain('Manual Issue');
    expect(stderrOutput).toContain('skipped (manual)');
  });

  it('passes overallStatus to buildRemediationUserMessage', async () => {
    const { buildRemediationUserMessage } = await import('../claude/prompts.js');
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    const finding = {
      title: 'Test Issue',
      severity: 'high',
      category: 'compliance',
      description: 'desc',
      affectedDeviceCount: 1,
      affectedDevices: [],
      remediation: { title: 'Fix', steps: [], effort: 'low', automatable: true },
    };

    mockAgentRun.mockResolvedValue({
      report: { summary: 'Issues', overallStatus: 'warning', findings: [finding], metrics: {} },
      rawText: '{}',
      toolCallCount: 1,
      rounds: 1,
    });

    const remReport = {
      summary: 'Fixed',
      originalReportStatus: 'warning',
      findingsAttempted: 1,
      findingsSucceeded: 1,
      findingsFailed: 0,
      actions: [],
      dryRun: false,
    };
    mockAgentRunRemediation.mockResolvedValue({
      report: remReport,
      rawText: JSON.stringify(remReport),
      toolCallCount: 1,
      rounds: 1,
    });

    await capturedActions.remediate('compliance', { autoApprove: true });

    expect(buildRemediationUserMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      'warning',
    );
  });

  describe('loadReportFromFile validation', () => {
    it('exits with error when finding is missing title', async () => {
      const { readFileSync } = await import('node:fs');
      (readFileSync as any).mockReturnValue(JSON.stringify({
        summary: 'Test',
        overallStatus: 'warning',
        findings: [{ severity: 'high', affectedDeviceCount: 1, affectedDevices: [], remediation: { automatable: true } }],
        metrics: {},
      }));

      const config = makeConfig();
      mockLoadConfig.mockResolvedValue(config);
      mockMCPConnect.mockResolvedValue(undefined);

      await capturedActions.remediate(undefined, { file: '/tmp/report.json', autoApprove: true });

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('missing title'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('exits with error when finding has invalid severity', async () => {
      const { readFileSync } = await import('node:fs');
      (readFileSync as any).mockReturnValue(JSON.stringify({
        summary: 'Test',
        overallStatus: 'warning',
        findings: [{ title: 'Bad', severity: 'extreme', affectedDeviceCount: 1, affectedDevices: [], remediation: { automatable: true } }],
        metrics: {},
      }));

      const config = makeConfig();
      mockLoadConfig.mockResolvedValue(config);
      mockMCPConnect.mockResolvedValue(undefined);

      await capturedActions.remediate(undefined, { file: '/tmp/report.json', autoApprove: true });

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('invalid severity'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('exits with error when finding is missing remediation.automatable', async () => {
      const { readFileSync } = await import('node:fs');
      (readFileSync as any).mockReturnValue(JSON.stringify({
        summary: 'Test',
        overallStatus: 'warning',
        findings: [{ title: 'Issue', severity: 'high', affectedDeviceCount: 1, affectedDevices: [], remediation: { title: 'Fix' } }],
        metrics: {},
      }));

      const config = makeConfig();
      mockLoadConfig.mockResolvedValue(config);
      mockMCPConnect.mockResolvedValue(undefined);

      await capturedActions.remediate(undefined, { file: '/tmp/report.json', autoApprove: true });

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('remediation.automatable must be a boolean'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('accepts valid findings from file', async () => {
      const { readFileSync } = await import('node:fs');
      (readFileSync as any).mockReturnValue(JSON.stringify({
        summary: 'Issues found',
        overallStatus: 'warning',
        findings: [{
          title: 'Valid Finding',
          severity: 'high',
          category: 'security',
          description: 'desc',
          affectedDeviceCount: 3,
          affectedDevices: [{ name: 'mac1', id: '1', detail: 'test' }],
          remediation: { title: 'Fix', steps: ['step1'], effort: 'low', automatable: true },
        }],
        metrics: {},
      }));

      const config = makeConfig();
      mockLoadConfig.mockResolvedValue(config);
      mockMCPConnect.mockResolvedValue(undefined);

      const remReport = {
        summary: 'Fixed',
        originalReportStatus: 'warning',
        findingsAttempted: 1,
        findingsSucceeded: 1,
        findingsFailed: 0,
        actions: [],
        dryRun: true,
      };
      mockAgentRunRemediation.mockResolvedValue({
        report: remReport,
        rawText: JSON.stringify(remReport),
        toolCallCount: 0,
        rounds: 1,
      });

      await capturedActions.remediate(undefined, { file: '/tmp/report.json', dryRun: true, autoApprove: true });

      // Should not exit with error — should proceed to remediation
      expect(mockConsoleError).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(remReport, null, 2));
    });
  });
});

describe('start command', () => {
  it('registers shutdown handler and starts scheduler', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    await capturedActions.start();

    expect(mockOnShutdown).toHaveBeenCalledTimes(2); // MCP disconnect + health check stop
    expect(typeof mockOnShutdown.mock.calls[0][0]).toBe('function');
    expect(typeof mockOnShutdown.mock.calls[1][0]).toBe('function');
    expect(mockStartScheduler).toHaveBeenCalledTimes(1);
    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it('passes agent, slack, and config to startScheduler', async () => {
    const config = makeSlackEnabledConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    await capturedActions.start();

    const schedulerArgs = mockStartScheduler.mock.calls[0][0];
    expect(schedulerArgs).toHaveProperty('agent');
    expect(schedulerArgs).toHaveProperty('slack');
    expect(schedulerArgs).toHaveProperty('config');
    expect(schedulerArgs.slack).not.toBeNull();
  });

  it('passes null slack to startScheduler when slack disabled', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);

    await capturedActions.start();

    const schedulerArgs = mockStartScheduler.mock.calls[0][0];
    expect(schedulerArgs.slack).toBeNull();
  });

  it('shutdown callback disconnects MCP', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    mockMCPConnect.mockResolvedValue(undefined);
    mockMCPDisconnect.mockResolvedValue(undefined);

    await capturedActions.start();

    const shutdownFn = mockOnShutdown.mock.calls[0][0];
    await shutdownFn();

    expect(mockMCPDisconnect).toHaveBeenCalledTimes(1);
  });
});
