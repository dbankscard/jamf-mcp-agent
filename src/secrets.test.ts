import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mockSend;
  },
  GetSecretValueCommand: class {
    constructor(public input: any) {}
  },
}));

import { fetchSecrets } from './secrets.js';
import { ConfigError } from './errors.js';

describe('fetchSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed JSON secret', async () => {
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ SLACK_BOT_TOKEN: 'xoxb-123', JAMF_CLIENT_SECRET: 'secret' }),
    });

    const result = await fetchSecrets('test-secret');
    expect(result).toEqual({
      SLACK_BOT_TOKEN: 'xoxb-123',
      JAMF_CLIENT_SECRET: 'secret',
    });
  });

  it('throws ConfigError when secret has no string value', async () => {
    mockSend.mockResolvedValue({ SecretString: undefined });

    await expect(fetchSecrets('empty-secret')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError on invalid JSON', async () => {
    mockSend.mockResolvedValue({ SecretString: 'not-json' });

    try {
      await fetchSecrets('bad-secret');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain('invalid JSON');
    }
  });

  it('throws ConfigError if secret is not an object', async () => {
    mockSend.mockResolvedValue({ SecretString: '"just a string"' });

    await expect(fetchSecrets('string-secret')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError if secret is an array', async () => {
    mockSend.mockResolvedValue({ SecretString: '[1,2,3]' });

    await expect(fetchSecrets('array-secret')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when AWS call fails', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException'));

    try {
      await fetchSecrets('no-access');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain('Failed to fetch secret');
    }
  });
});
