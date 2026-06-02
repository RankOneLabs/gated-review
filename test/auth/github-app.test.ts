import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadGitHubAppConfig } from '#root/src/config.js';

describe('GitHub app config loading', () => {
  it('loads inline secrets and normalizes escaped newlines', async () => {
    const result = await loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nline-one\\n-----END PRIVATE KEY-----',
      GITHUB_API_BASE_URL: 'https://example.com/api'
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        appId: 123,
        installationId: 456,
        privateKey: '-----BEGIN PRIVATE KEY-----\nline-one\n-----END PRIVATE KEY-----',
        apiBaseUrl: 'https://example.com/api'
      });
    }
  });

  it('loads a file mounted private key when the inline secret is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gated-review-config-'));
    const keyPath = join(dir, 'github.pem');
    const pem = '-----BEGIN PRIVATE KEY-----\nfrom-file\n-----END PRIVATE KEY-----\n';
    await writeFile(keyPath, pem, 'utf8');

    const result = await loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY_PATH: keyPath
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.privateKey).toBe(pem);
      expect(result.value.apiBaseUrl).toBe('https://api.github.com');
    }
  });

  it('rejects missing credentials and invalid urls', async () => {
    const missingKey = await loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456'
    });

    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) {
      expect(missingKey.error.kind).toBe('missing_configuration');
      expect(missingKey.error.detail).toContain('GITHUB_APP_PRIVATE_KEY');
    }

    const invalidUrl = await loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: 'key',
      GITHUB_API_BASE_URL: 'not-a-url'
    });

    expect(invalidUrl.ok).toBe(false);
    if (!invalidUrl.ok) {
      expect(invalidUrl.error.kind).toBe('invalid_configuration');
      expect(invalidUrl.error.detail).toContain('GITHUB_API_BASE_URL');
    }
  });

  it('resolves installation-token requests against path-prefixed api bases', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ format: 'pem', type: 'pkcs1' }).toString();
    const requestedUrls: Array<string> = [];

    const result = await loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_API_BASE_URL: 'https://example.com/api/v3'
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { createGitHubAppAuth } = await import('#root/src/auth/github-app.js');
      const auth = createGitHubAppAuth(result.value, {
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response(
            JSON.stringify({
              token: 'installation-token',
              expires_at: '2026-06-02T20:00:00.000Z'
            }),
            {
              status: 201,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        },
        now: () => Date.parse('2026-06-02T19:00:00.000Z')
      });

      expect(auth.ok).toBe(true);
      if (auth.ok) {
        const token = await auth.value.mintInstallationToken(456);
        expect(token.ok).toBe(true);
      }
    }

    expect(requestedUrls).toEqual([
      'https://example.com/api/v3/app/installations/456/access_tokens'
    ]);
  });
});
