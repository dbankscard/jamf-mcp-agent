import { describe, it, expect } from 'vitest';
import { getSystemPrompt, getUserMessage, type ReportType } from './prompts.js';

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
