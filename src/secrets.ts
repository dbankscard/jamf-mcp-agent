import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { ConfigError } from './errors.js';

export async function fetchSecrets(
  secretName: string,
  region?: string,
): Promise<Record<string, string>> {
  const client = new SecretsManagerClient({ region: region ?? 'us-east-1' });

  let secretString: string;
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );
    if (!result.SecretString) {
      throw new ConfigError('Secret has no string value', {
        context: { secretName },
      });
    }
    secretString = result.SecretString;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to fetch secret: ${secretName}`, {
      context: { secretName },
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }

  try {
    const parsed = JSON.parse(secretString);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConfigError('Secret is not a JSON object', {
        context: { secretName },
      });
    }
    return parsed as Record<string, string>;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError('Secret contains invalid JSON', {
      context: { secretName },
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }
}
