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

export interface AgentResult {
  report: AgentReport | null;
  rawText: string;
  toolCallCount: number;
  rounds: number;
}
