import { err, ok, type Result } from '#root/src/result.js';
import type { GitHubAppAuth, GitHubInstallationToken } from '#root/src/auth/github-app.js';
import type { GitHubError } from '#root/src/github/errors.js';

export interface GitHubInstallationTokenProvider {
  getInstallationToken(installationId: number): Promise<Result<string, GitHubError>>;
}

type CachedToken = {
  token: string;
  expiresAtMs: number;
};

export type GitHubInstallationTokenCacheOptions = {
  refreshBeforeMs?: number;
  now?: () => number;
};

export class GitHubInstallationTokenCache {
  private readonly cache = new Map<number, CachedToken>();
  private readonly refreshBeforeMs: number;
  private readonly now: () => number;

  constructor(
    private readonly auth: GitHubAppAuth,
    options: GitHubInstallationTokenCacheOptions = {}
  ) {
    this.refreshBeforeMs = options.refreshBeforeMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  async getInstallationToken(installationId: number): Promise<Result<string, GitHubError>> {
    const cached = this.cache.get(installationId);
    const nowMs = this.now();
    if (cached !== undefined && cached.expiresAtMs - this.refreshBeforeMs > nowMs) {
      return ok(cached.token);
    }

    const minted = await this.auth.mintInstallationToken(installationId);
    if (!minted.ok) {
      return err(minted.error);
    }

    this.cache.set(installationId, this.toCachedToken(minted.value));
    return ok(minted.value.token);
  }

  clear(installationId?: number) {
    if (installationId === undefined) {
      this.cache.clear();
      return;
    }

    this.cache.delete(installationId);
  }

  private toCachedToken(token: GitHubInstallationToken): CachedToken {
    return {
      token: token.token,
      expiresAtMs: token.expiresAt.getTime()
    };
  }
}
