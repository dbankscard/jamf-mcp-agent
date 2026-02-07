export type ReportType = 'compliance' | 'security' | 'fleet' | 'adhoc';

const REPORT_SCHEMA_INSTRUCTION = `
You MUST output your final answer as a single JSON object with this exact schema (no markdown fences):
{
  "summary": "<1-3 sentence executive summary>",
  "overallStatus": "healthy" | "warning" | "critical",
  "findings": [
    {
      "title": "<short title>",
      "severity": "critical" | "high" | "medium" | "low",
      "category": "compliance" | "security" | "maintenance",
      "description": "<detailed description>",
      "affectedDeviceCount": <number>,
      "affectedDevices": [{ "name": "<hostname>", "id": "<jamf id>", "detail": "<why flagged>" }],
      "remediation": {
        "title": "<action title>",
        "steps": ["step 1", "step 2"],
        "effort": "low" | "medium" | "high",
        "automatable": true | false
      }
    }
  ],
  "metrics": { "<metricName>": <value>, ... }
}

Rules:
- Limit affectedDevices to 10 per finding (mention total in affectedDeviceCount).
- Sort findings by severity (critical first).
- Include at least one metric (e.g., totalDevices, complianceRate, encryptionRate).
- If the fleet is healthy, still include a summary and empty findings array.
`;

const SYSTEM_PROMPTS: Record<ReportType, string> = {
  compliance: `You are a Jamf IT compliance analyst agent. Your job is to produce a structured compliance report.

Steps:
1. Call getFleetOverview to understand the fleet size and composition.
2. Call getSecurityPosture to get encryption, compliance, and OS currency data.
3. Call getDeviceComplianceSummary for a compliance breakdown.
4. If non-compliant devices exist, call checkDeviceCompliance on a sample (up to 5) to get specifics.
5. Look for patterns: outdated OS, missing encryption, failed policies, unmanaged devices.

${REPORT_SCHEMA_INSTRUCTION}`,

  security: `You are a Jamf IT security analyst agent. Your job is to produce a structured security posture report.

Steps:
1. Call getSecurityPosture for encryption rates, OS currency, and compliance metrics.
2. Call getFleetOverview for fleet composition context.
3. Call listConfigurationProfiles and pick any that seem security-related to inspect with getConfigurationProfileDetails.
4. Call listRestrictedSoftware to check for blocked apps.
5. Check LAPS status via getLocalAdminPasswordAccounts on a sample device if available.
6. Look for gaps: unencrypted disks, outdated macOS, missing security profiles.

${REPORT_SCHEMA_INSTRUCTION}`,

  fleet: `You are a Jamf IT fleet health analyst agent. Your job is to produce a structured fleet health report.

Steps:
1. Call getFleetOverview for total devices, OS breakdown, and enrollment status.
2. Call getInventorySummary for hardware and software inventory stats.
3. Call getSecurityPosture for patch compliance and OS distribution.
4. Call listMobileDevices to check mobile fleet status.
5. Look at device age, OS distribution, enrollment trends, and hardware diversity.

${REPORT_SCHEMA_INSTRUCTION}`,

  adhoc: `You are a Jamf IT admin assistant agent. Answer the user's question by querying the Jamf environment.

Use the available tools to gather data, then provide a clear, concise answer.
If the answer benefits from structured data, format it as a JSON report:
${REPORT_SCHEMA_INSTRUCTION}
Otherwise, provide a plain-text answer.`,
};

export function getSystemPrompt(type: ReportType): string {
  return SYSTEM_PROMPTS[type];
}

export function getUserMessage(type: ReportType, extra?: string): string {
  const messages: Record<ReportType, string> = {
    compliance: 'Run a compliance check on the fleet and produce a report.',
    security: 'Analyze the security posture of the fleet and produce a report.',
    fleet: 'Produce a fleet health report covering device inventory, OS distribution, and overall status.',
    adhoc: extra ?? 'Describe the current state of the fleet.',
  };
  return messages[type];
}
