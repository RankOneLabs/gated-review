import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import type { GitHubAppAuth, GitHubInstallationToken } from '#root/src/auth/github-app.js';
import { GitHubInstallationTokenCache } from '#root/src/auth/token-cache.js';

describe('GitHub installation token cache', () => {
  it('reuses a token until it is close to expiring', async () => {
    let now = 1_000_000;
    let mintCount = 0;
    const auth: GitHubAppAuth = {
      async mintInstallationToken(installationId: number) {
        mintCount += 1;
        const token: GitHubInstallationToken = {
          installationId,
          token: `token-${mintCount}`,
          expiresAt: new Date(now + 120_000)
        };
        return ok(token);
      },
      async lookupInstallationId() {
        return ok(1);
      }
    };

    const cache = new GitHubInstallationTokenCache(auth, {
      now: () => now,
      refreshBeforeMs: 60_000
    });

    const first = await cache.getInstallationToken(123);
    const second = await cache.getInstallationToken(123);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).toBe('token-1');
      expect(second.value).toBe('token-1');
    }
    expect(mintCount).toBe(1);

    now = 1_060_001;
    const refreshed = await cache.getInstallationToken(123);

    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.value).toBe('token-2');
    }
    expect(mintCount).toBe(2);
  });

  it('keeps installation scopes separate', async () => {
    const minted: Array<number> = [];
    const auth: GitHubAppAuth = {
      async mintInstallationToken(installationId: number) {
        minted.push(installationId);
        return ok({
          installationId,
          token: `token-${installationId}`,
          expiresAt: new Date(Date.now() + 120_000)
        });
      },
      async lookupInstallationId() {
        return ok(1);
      }
    };

    const cache = new GitHubInstallationTokenCache(auth);

    const first = await cache.getInstallationToken(123);
    const second = await cache.getInstallationToken(456);

    expect(first.ok && first.value).toBe('token-123');
    expect(second.ok && second.value).toBe('token-456');
    expect(minted).toEqual([123, 456]);
  });
});
