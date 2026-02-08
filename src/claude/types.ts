export interface AgentReport {
  summary: string;
  overallStatus: 'healthy' | 'warning' | 'critical';
  findings: Finding[];
  metrics: Record<string, string | number>;
}

export interface Finding {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'compliance' | 'security' | 'maintenance';
  description: string;
  affectedDeviceCount: number;
  affectedDevices: AffectedDevice[];
  remediation: Remediation;
}

export interface AffectedDevice {
  name: string;
  id: string;
  detail: string;
}

export interface Remediation {
  title: string;
  steps: string[];
  effort: string;
  automatable: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentResult {
  report: AgentReport | null;
  rawText: string;
  toolCallCount: number;
  rounds: number;
  tokenUsage: TokenUsage;
}

export interface RemediationAction {
  findingIndex: number;
  findingTitle: string;
  action: string;
  toolsUsed: string[];
  status: 'success' | 'partial' | 'failed' | 'skipped';
  devicesRemediated: number;
  details: string;
  error?: string;
}

export interface RemediationReport {
  summary: string;
  originalReportStatus: 'healthy' | 'warning' | 'critical';
  findingsAttempted: number;
  findingsSucceeded: number;
  findingsFailed: number;
  actions: RemediationAction[];
  dryRun: boolean;
}

export interface RemediationResult {
  report: RemediationReport | null;
  rawText: string;
  toolCallCount: number;
  rounds: number;
  tokenUsage: TokenUsage;
}
