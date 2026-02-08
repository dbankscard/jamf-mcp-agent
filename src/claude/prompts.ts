export const PROMPT_VERSION = '2.0.0';

export type ReportType = 'compliance' | 'security' | 'fleet' | 'adhoc' | 'adhoc-write';

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

/**
 * All write/mutating Jamf MCP tools, grouped by category.
 * Exported for testing — prompts reference every tool so the agent knows its full remediation surface.
 */
export const WRITE_TOOLS_BY_CATEGORY: Record<string, string[]> = {
  'Policy Management': [
    'executePolicy',
    'createPolicy',
    'updatePolicy',
    'clonePolicy',
    'setPolicyEnabled',
    'updatePolicyScope',
  ],
  'Configuration Profiles': [
    'deployConfigurationProfile',
    'removeConfigurationProfile',
  ],
  'Software Updates': [
    'createSoftwareUpdatePlan',
  ],
  'MDM Commands': [
    'sendComputerMDMCommand',
    'sendMDMCommand',
    'flushMDMCommands',
  ],
  'Scripts': [
    'deployScript',
    'createScript',
    'updateScript',
    'deleteScript',
  ],
  'Groups & Searches': [
    'createStaticComputerGroup',
    'updateStaticComputerGroup',
    'deleteComputerGroup',
    'createAdvancedComputerSearch',
    'deleteAdvancedComputerSearch',
  ],
  'Inventory & Attributes': [
    'updateInventory',
    'updateMobileDeviceInventory',
    'createComputerExtensionAttribute',
    'updateComputerExtensionAttribute',
  ],
  'Compound Skills': [
    'skill_batch_inventory_update',
    'skill_deploy_policy_by_criteria',
    'skill_device_search',
    'skill_find_outdated_devices',
    'skill_scheduled_compliance_check',
  ],
};

function buildWriteToolReference(): string {
  return Object.entries(WRITE_TOOLS_BY_CATEGORY)
    .map(([category, tools]) => `**${category}:** ${tools.join(', ')}`)
    .join('\n');
}

const SYSTEM_PROMPTS: Record<ReportType, string> = {
  compliance: `You are a Jamf IT compliance analyst agent. Your job is to produce a structured compliance report.

Pre-fetched resource data may be appended to the user message. Use it to avoid redundant tool calls.

Steps:
1. Review any pre-fetched resource data first.
2. Call getFleetOverview to understand the fleet size and composition.
3. Call getSecurityPosture to get encryption, compliance, and OS currency data.
4. Call getDeviceComplianceSummary for a compliance breakdown.
5. If non-compliant devices exist, call checkDeviceCompliance on a sample (up to 5) to get specifics.
6. Look for patterns: outdated OS, missing encryption, failed policies, unmanaged devices.

${REPORT_SCHEMA_INSTRUCTION}`,

  security: `You are a Jamf IT security analyst agent. Your job is to produce a structured security posture report.

Pre-fetched resource data may be appended to the user message. Use it to avoid redundant tool calls.

Steps:
1. Review any pre-fetched resource data first.
2. Call getSecurityPosture for encryption rates, OS currency, and compliance metrics.
3. Call getFleetOverview for fleet composition context.
4. Call listConfigurationProfiles and pick any that seem security-related to inspect with getConfigurationProfileDetails.
5. Call listRestrictedSoftware to check for blocked apps.
6. Check LAPS status via getLocalAdminPasswordAccounts on a sample device if available.
7. Look for gaps: unencrypted disks, outdated macOS, missing security profiles.

${REPORT_SCHEMA_INSTRUCTION}`,

  fleet: `You are a Jamf IT fleet health analyst agent. Your job is to produce a structured fleet health report.

Pre-fetched resource data may be appended to the user message. Use it to avoid redundant tool calls.

Steps:
1. Review any pre-fetched resource data first.
2. Call getFleetOverview for total devices, OS breakdown, and enrollment status.
3. Call getInventorySummary for hardware and software inventory stats.
4. Call getSecurityPosture for patch compliance and OS distribution.
5. Call listMobileDevices to check mobile fleet status.
6. Look at device age, OS distribution, enrollment trends, and hardware diversity.

${REPORT_SCHEMA_INSTRUCTION}`,

  adhoc: `You are a Jamf IT admin assistant agent. Answer the user's question by querying the Jamf environment.

Use the available tools to gather data, then provide a clear, concise answer.
If the answer benefits from structured data, format it as a JSON report:
${REPORT_SCHEMA_INSTRUCTION}
Otherwise, provide a plain-text answer.`,

  'adhoc-write': `You are a Jamf IT admin assistant agent with write access to the Jamf environment.

You can both read data AND make changes (create policies, deploy profiles, send MDM commands, etc.).

SAFETY RULES:
- Always confirm your understanding of the request before making destructive changes.
- Use read tools first to verify current state before modifying anything.
- Include confirm: true in all write tool calls.
- Prefer targeted actions (specific devices/groups) over fleet-wide changes.
- Report exactly what was changed, including device names and IDs.

Available write tools by category:
${buildWriteToolReference()}

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
    'adhoc-write': extra ?? 'Describe the current state of the fleet.',
  };
  return messages[type];
}

const REMEDIATION_SCHEMA_INSTRUCTION = `
You MUST output your final answer as a single JSON object with this exact schema (no markdown fences):
{
  "summary": "<1-3 sentence summary of remediation results>",
  "originalReportStatus": "healthy" | "warning" | "critical",
  "findingsAttempted": <number>,
  "findingsSucceeded": <number>,
  "findingsFailed": <number>,
  "actions": [
    {
      "findingIndex": <original finding index>,
      "findingTitle": "<original finding title>",
      "action": "<what was done>",
      "toolsUsed": ["<tool1>", "<tool2>"],
      "status": "success" | "partial" | "failed" | "skipped",
      "devicesRemediated": <number>,
      "details": "<detailed description of what happened>",
      "error": "<error message, only if status is failed or partial>"
    }
  ],
  "dryRun": <boolean>
}

Rules:
- One action entry per finding attempted.
- Set status to "success" only if all affected devices were remediated.
- Set status to "partial" if some but not all devices were remediated.
- Set status to "skipped" if the finding cannot be remediated automatically.
- Include the error field only when status is "failed" or "partial".
- Set originalReportStatus to the overallStatus value provided in the input — do not infer it from finding severities.
`;

export function getRemediationPrompt(dryRun: boolean): string {
  const toolReference = buildWriteToolReference();

  if (dryRun) {
    return `You are a Jamf IT remediation planning agent. Your job is to analyze the provided findings and describe what remediation actions WOULD be taken, without actually executing any write tools.

For each finding, describe:
- Which Jamf tools would be used
- What parameters would be passed
- How many devices would be affected
- Any risks or prerequisites

Available write tools by category:
${toolReference}

Do NOT call any write/mutating tools. Only use read tools if you need additional context.

Specificity requirements:
- Reference existing policies and profiles by name and ID — use read tools to look them up first.
- List affected device names (not just counts) in the details field.
- Include specific tool parameters in the details (policy IDs, profile IDs, device IDs, MDM command names).
- For dry-run: describe exact parameters that would be passed to each tool call.

Set dryRun to true in your output.

${REMEDIATION_SCHEMA_INSTRUCTION}`;
  }

  return `You are a Jamf IT remediation agent. Your job is to fix the provided findings by calling the appropriate Jamf write tools.

Available write tools by category:
${toolReference}

For each finding, determine the best remediation approach and execute it. Common patterns:
- executePolicy to trigger existing policies on specific devices
- deployConfigurationProfile to push security/compliance profiles
- createSoftwareUpdatePlan to schedule OS updates
- sendComputerMDMCommand / sendMDMCommand to send MDM commands (e.g., EnableRemoteDesktop, RefreshCertificate)
- deployScript to run scripts on devices
- createStaticComputerGroup to organize devices for targeted actions
- updatePolicy / updatePolicyScope to adjust policy targeting
- setPolicyEnabled to enable/disable policies
- createPolicy / clonePolicy to create new policies from scratch or existing ones
- updateInventory / updateMobileDeviceInventory to refresh device inventory
- createComputerExtensionAttribute / updateComputerExtensionAttribute to track custom data
- removeConfigurationProfile to remove unwanted profiles
- flushMDMCommands to clear pending commands on stuck devices
- createAdvancedComputerSearch to build device queries for follow-up

IMPORTANT: Always include confirm: true in all write tool calls.

Specificity requirements:
- Reference existing policies and profiles by name and ID — use read tools to look them up first.
- List affected device names (not just counts) in the details field.
- Include specific tool parameters in the details (policy IDs, profile IDs, device IDs, MDM command names).

Work through each finding methodically. If a finding cannot be automatically remediated, set its status to "skipped" and explain why.

Set dryRun to false in your output.

${REMEDIATION_SCHEMA_INSTRUCTION}`;
}

const RESOURCE_MAP: Record<string, string[]> = {
  compliance: [
    'jamf://reports/compliance',
    'jamf://reports/encryption-status',
    'jamf://reports/os-versions',
  ],
  security: [
    'jamf://reports/encryption-status',
    'jamf://reports/patch-compliance',
    'jamf://reports/laps-audit',
    'jamf://reports/failed-mdm-commands',
  ],
  fleet: [
    'jamf://inventory/computers',
    'jamf://reports/os-versions',
    'jamf://inventory/mobile-devices',
    'jamf://reports/storage',
  ],
};

export function getResourceUris(type: ReportType): string[] {
  return RESOURCE_MAP[type] ?? [];
}

export function buildResourceContext(resources: Record<string, string>): string {
  if (Object.keys(resources).length === 0) return '';
  const sections = Object.entries(resources)
    .map(([uri, content]) => `--- ${uri} ---\n${content}`)
    .join('\n\n');
  return `\n\nPre-fetched resource data (use this to reduce tool calls):\n\n${sections}\n`;
}

export function buildRemediationUserMessage(
  findings: import('./types.js').Finding[],
  selectedIndices: number[],
  overallStatus?: string,
): string {
  const selected = selectedIndices
    .map(i => {
      const f = findings[i];
      if (!f) return null;
      return {
        index: i,
        title: f.title,
        severity: f.severity,
        category: f.category,
        description: f.description,
        affectedDeviceCount: f.affectedDeviceCount,
        affectedDevices: f.affectedDevices,
        remediation: f.remediation,
      };
    })
    .filter(Boolean);

  const statusLine = overallStatus ? `The original report had overallStatus: "${overallStatus}".\n\n` : '';
  return `${statusLine}Remediate the following ${selected.length} finding(s):\n\n${JSON.stringify(selected, null, 2)}`;
}
