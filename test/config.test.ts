import { describe, expect, it } from 'vitest';

import { loadGitHubAppConfig } from '#root/src/config.js';

const baseEnv = {
  GITHUB_APP_ID: '123',
  GITHUB_APP_INSTALLATION_ID: '456',
  GITHUB_APP_PRIVATE_KEY: 'key'
};

describe('GATED_REVIEW_HTTP_PORT config validation', () => {
  it('is required — rejects when absent', async () => {
    const result = await loadGitHubAppConfig(baseEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing_configuration');
      expect(result.error.detail).toContain('GATED_REVIEW_HTTP_PORT');
    }
  });

  it('is required — rejects when empty string', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing_configuration');
      expect(result.error.detail).toContain('GATED_REVIEW_HTTP_PORT');
    }
  });

  it('rejects non-integer values', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_configuration');
      expect(result.error.detail).toContain('GATED_REVIEW_HTTP_PORT');
    }
  });

  it('rejects zero', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_configuration');
    }
  });

  it('rejects negative integers', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: '-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_configuration');
    }
  });

  it('rejects ports above 65535', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: '65536' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_configuration');
      expect(result.error.detail).toContain('GATED_REVIEW_HTTP_PORT');
    }
  });

  it('accepts the maximum valid port 65535', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: '65535' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.httpPort).toBe(65535);
    }
  });

  it('accepts a valid port and surfaces it on the config object', async () => {
    const result = await loadGitHubAppConfig({ ...baseEnv, GATED_REVIEW_HTTP_PORT: '3000' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.httpPort).toBe(3000);
    }
  });
});
