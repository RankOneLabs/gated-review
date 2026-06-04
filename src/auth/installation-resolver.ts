import { ok, type Result } from '#root/src/result.js';
import type { GitHubAppAuth } from '#root/src/auth/github-app.js';
import type { GitHubError } from '#root/src/github/errors.js';

/**
 * Resolves a repository owner to the GitHub App installation that covers it.
 *
 * A GitHub App installation is scoped to a single account (org or user), so the
 * installation id is a property of the owner, not the individual repository.
 * The resolver caches per owner and discovers ids on demand via the App JWT,
 * which lets one deployment serve repositories across multiple accounts without
 * configuring any installation ids.
 */
export interface InstallationResolver {
  resolveInstallationId(owner: string, repo: string): Promise<Result<number, GitHubError>>;
}

export class GitHubInstallationResolver implements InstallationResolver {
  private readonly cache = new Map<string, number>();

  constructor(private readonly auth: GitHubAppAuth) {}

  async resolveInstallationId(owner: string, repo: string): Promise<Result<number, GitHubError>> {
    const key = owner.toLowerCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return ok(cached);
    }

    const looked = await this.auth.lookupInstallationId(owner, repo);
    if (!looked.ok) {
      return looked;
    }

    this.cache.set(key, looked.value);
    return ok(looked.value);
  }

  clear(owner?: string) {
    if (owner === undefined) {
      this.cache.clear();
      return;
    }

    this.cache.delete(owner.toLowerCase());
  }
}

/** Adapts a fixed installation id into the resolver interface (single-account fallback). */
export function fixedInstallationResolver(installationId: number): InstallationResolver {
  return {
    async resolveInstallationId() {
      return ok(installationId);
    }
  };
}
