import { describe, it, expect } from 'vitest';
import { getSystemPrompt, getUserMessage, type ReportType, getRemediationPrompt, buildRemediationUserMessage, WRITE_TOOLS_BY_CATEGORY } from './prompts.js';
import type { Finding } from './types.js';

describe('prompts', () => {
  describe('getSystemPrompt', () => {
    it('compliance report includes "compliance"', () => {
      const prompt = getSystemPrompt('compliance');
      expect(prompt).toContain('compliance');
    });

    it('security report includes "security"', () => {
      const prompt = getSystemPrompt('security');
      expect(prompt).toContain('security');
    });

    it('fleet report includes "fleet"', () => {
      const prompt = getSystemPrompt('fleet');
      expect(prompt).toContain('fleet');
    });

    it('adhoc report includes "assistant"', () => {
      const prompt = getSystemPrompt('adhoc');
      expect(prompt).toContain('assistant');
    });

    it('compliance prompt returns a non-empty string', () => {
      const prompt = getSystemPrompt('compliance');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('security prompt returns a non-empty string', () => {
      const prompt = getSystemPrompt('security');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('fleet prompt returns a non-empty string', () => {
      const prompt = getSystemPrompt('fleet');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('adhoc prompt returns a non-empty string', () => {
      const prompt = getSystemPrompt('adhoc');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('JSON schema instruction', () => {
    it('compliance prompt includes JSON schema instruction', () => {
      const prompt = getSystemPrompt('compliance');
      expect(prompt).toContain('JSON object');
      expect(prompt).toContain('summary');
      expect(prompt).toContain('overallStatus');
      expect(prompt).toContain('findings');
    });

    it('security prompt includes JSON schema instruction', () => {
      const prompt = getSystemPrompt('security');
      expect(prompt).toContain('JSON object');
      expect(prompt).toContain('summary');
      expect(prompt).toContain('overallStatus');
      expect(prompt).toContain('findings');
    });

    it('fleet prompt includes JSON schema instruction', () => {
      const prompt = getSystemPrompt('fleet');
      expect(prompt).toContain('JSON object');
      expect(prompt).toContain('summary');
      expect(prompt).toContain('overallStatus');
      expect(prompt).toContain('findings');
    });

    it('adhoc prompt includes JSON schema instruction', () => {
      const prompt = getSystemPrompt('adhoc');
      expect(prompt).toContain('JSON object');
      expect(prompt).toContain('summary');
      expect(prompt).toContain('overallStatus');
      expect(prompt).toContain('findings');
    });
  });

  describe('getUserMessage', () => {
    it('compliance returns compliance message', () => {
      const message = getUserMessage('compliance');
      expect(message).toContain('compliance');
      expect(message).toContain('report');
    });

    it('security returns security message', () => {
      const message = getUserMessage('security');
      expect(message).toContain('security');
      expect(message).toContain('report');
    });

    it('fleet returns fleet message', () => {
      const message = getUserMessage('fleet');
      expect(message).toContain('fleet');
      expect(message).toContain('report');
    });

    it('adhoc returns default adhoc message', () => {
      const message = getUserMessage('adhoc');
      expect(message).toBe('Describe the current state of the fleet.');
    });

    it('adhoc with custom question returns custom question', () => {
      const customQuestion = 'What is the status of our macOS Ventura devices?';
      const message = getUserMessage('adhoc', customQuestion);
      expect(message).toBe(customQuestion);
    });

    it('adhoc with empty string returns empty string', () => {
      const message = getUserMessage('adhoc', '');
      expect(message).toBe('');
    });

    it('compliance returns a non-empty string', () => {
      const message = getUserMessage('compliance');
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('security returns a non-empty string', () => {
      const message = getUserMessage('security');
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('fleet returns a non-empty string', () => {
      const message = getUserMessage('fleet');
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('ReportType type', () => {
    it('all valid report types are supported', () => {
      const types: ReportType[] = ['compliance', 'security', 'fleet', 'adhoc'];
      types.forEach((type) => {
        const systemPrompt = getSystemPrompt(type);
        const userMessage = getUserMessage(type);
        expect(systemPrompt).toBeDefined();
        expect(userMessage).toBeDefined();
      });
    });
  });
});

describe('WRITE_TOOLS_BY_CATEGORY', () => {
  it('contains all expected categories', () => {
    const categories = Object.keys(WRITE_TOOLS_BY_CATEGORY);
    expect(categories).toContain('Policy Management');
    expect(categories).toContain('Configuration Profiles');
    expect(categories).toContain('Software Updates');
    expect(categories).toContain('MDM Commands');
    expect(categories).toContain('Scripts');
    expect(categories).toContain('Groups & Searches');
    expect(categories).toContain('Inventory & Attributes');
  });

  it('has no empty categories', () => {
    for (const [category, tools] of Object.entries(WRITE_TOOLS_BY_CATEGORY)) {
      expect(tools.length, `${category} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('contains all 25 write tools', () => {
    const allTools = Object.values(WRITE_TOOLS_BY_CATEGORY).flat();
    expect(allTools).toHaveLength(25);
  });

  const expectedTools = [
    'executePolicy',
    'createPolicy',
    'updatePolicy',
    'clonePolicy',
    'setPolicyEnabled',
    'updatePolicyScope',
    'deployConfigurationProfile',
    'removeConfigurationProfile',
    'createSoftwareUpdatePlan',
    'sendComputerMDMCommand',
    'sendMDMCommand',
    'flushMDMCommands',
    'deployScript',
    'createScript',
    'updateScript',
    'deleteScript',
    'createStaticComputerGroup',
    'updateStaticComputerGroup',
    'deleteComputerGroup',
    'createAdvancedComputerSearch',
    'deleteAdvancedComputerSearch',
    'updateInventory',
    'updateMobileDeviceInventory',
    'createComputerExtensionAttribute',
    'updateComputerExtensionAttribute',
  ];

  it.each(expectedTools)('includes write tool: %s', (tool) => {
    const allTools = Object.values(WRITE_TOOLS_BY_CATEGORY).flat();
    expect(allTools).toContain(tool);
  });
});

describe('getRemediationPrompt', () => {
  it('returns dry-run prompt when dryRun is true', () => {
    const prompt = getRemediationPrompt(true);
    expect(prompt).toContain('planning');
    expect(prompt).toContain('Do NOT call any write');
    expect(prompt).toContain('dryRun');
  });

  it('returns live prompt when dryRun is false', () => {
    const prompt = getRemediationPrompt(false);
    expect(prompt).toContain('remediation agent');
    expect(prompt).toContain('confirm: true');
    expect(prompt).toContain('dryRun');
  });

  it('dry-run prompt includes JSON schema instruction', () => {
    const prompt = getRemediationPrompt(true);
    expect(prompt).toContain('actions');
    expect(prompt).toContain('findingsAttempted');
    expect(prompt).toContain('findingsSucceeded');
  });

  it('live prompt includes JSON schema instruction', () => {
    const prompt = getRemediationPrompt(false);
    expect(prompt).toContain('actions');
    expect(prompt).toContain('findingsAttempted');
    expect(prompt).toContain('findingsSucceeded');
  });

  // Verify every write tool appears in both prompt variants
  const allWriteTools = Object.values(WRITE_TOOLS_BY_CATEGORY).flat();

  describe('live prompt references all write tools', () => {
    const livePrompt = getRemediationPrompt(false);
    it.each(allWriteTools)('mentions %s', (tool) => {
      expect(livePrompt).toContain(tool);
    });
  });

  describe('dry-run prompt references all write tools', () => {
    const dryRunPrompt = getRemediationPrompt(true);
    it.each(allWriteTools)('mentions %s', (tool) => {
      expect(dryRunPrompt).toContain(tool);
    });
  });

  it('live prompt includes all category headers', () => {
    const prompt = getRemediationPrompt(false);
    for (const category of Object.keys(WRITE_TOOLS_BY_CATEGORY)) {
      expect(prompt).toContain(category);
    }
  });

  it('dry-run prompt includes all category headers', () => {
    const prompt = getRemediationPrompt(true);
    for (const category of Object.keys(WRITE_TOOLS_BY_CATEGORY)) {
      expect(prompt).toContain(category);
    }
  });
});

describe('buildRemediationUserMessage', () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      title: 'Outdated OS',
      severity: 'high',
      category: 'compliance',
      description: 'Devices running old OS.',
      affectedDeviceCount: 5,
      affectedDevices: [{ name: 'mac1', id: '1', detail: 'old OS' }],
      remediation: { title: 'Update OS', steps: ['update'], effort: 'low', automatable: true },
      ...overrides,
    };
  }

  it('serializes selected findings by index', () => {
    const findings = [
      makeFinding({ title: 'Finding A' }),
      makeFinding({ title: 'Finding B' }),
      makeFinding({ title: 'Finding C' }),
    ];
    const message = buildRemediationUserMessage(findings, [0, 2]);
    expect(message).toContain('2 finding(s)');
    expect(message).toContain('Finding A');
    expect(message).toContain('Finding C');
    expect(message).not.toContain('Finding B');
  });

  it('includes finding index in serialized output', () => {
    const findings = [makeFinding({ title: 'Only Finding' })];
    const message = buildRemediationUserMessage(findings, [0]);
    const parsed = JSON.parse(message.split('\n\n')[1]);
    expect(parsed[0].index).toBe(0);
  });

  it('filters out invalid indices', () => {
    const findings = [makeFinding({ title: 'Only' })];
    const message = buildRemediationUserMessage(findings, [0, 5, -1]);
    expect(message).toContain('1 finding(s)');
  });

  it('returns empty array when no valid indices', () => {
    const findings = [makeFinding()];
    const message = buildRemediationUserMessage(findings, [99]);
    expect(message).toContain('0 finding(s)');
  });
});
