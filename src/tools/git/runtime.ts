import { createGitHubAppAuth } from '#root/src/auth/github-app.js';
import { GitHubInstallationTokenCache } from '#root/src/auth/token-cache.js';
import { GitHubInstallationResolver } from '#root/src/auth/installation-resolver.js';
import { loadGitHubAppConfig } from '#root/src/config.js';
import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { GitRunnerDependencies } from '#root/src/tools/git/runner.js';

let cachedDependencies: Result<GitRunnerDependencies, ToolDomainError> | undefined;
let cachedDependenciesPromise: Promise<Result<GitRunnerDependencies, ToolDomainError>> | undefined;

function toRuntimeError(detail: string): ToolDomainError {
  return validationRejectedError('git.runtime', detail);
}

function deriveGitHubHosts(apiBaseUrl: string): readonly string[] {
  const host = new URL(apiBaseUrl).host;
  if (host.startsWith('api.') && host.length > 4) {
    return [host, host.slice(4)];
  }

  return [host];
}

async function loadDefaultGitRunnerDependencies(): Promise<Result<GitRunnerDependencies, ToolDomainError>> {
  const config = await loadGitHubAppConfig();
  if (!config.ok) {
    return err(toRuntimeError(config.error.detail));
  }

  const auth = createGitHubAppAuth(config.value);
  if (!auth.ok) {
    return err(toRuntimeError(auth.error.message));
  }

  const resolver = new GitHubInstallationResolver(auth.value);

  return ok({
    installationId: config.value.installationId,
    resolveInstallationId:
      config.value.installationId === undefined
        ? (owner, repo) => resolver.resolveInstallationId(owner, repo)
        : undefined,
    tokenProvider: new GitHubInstallationTokenCache(auth.value),
    githubHosts: deriveGitHubHosts(config.value.apiBaseUrl)
  });
}

export async function getDefaultGitRunnerDependencies(): Promise<
  Result<GitRunnerDependencies, ToolDomainError>
> {
  if (cachedDependencies !== undefined) {
    return cachedDependencies;
  }

  if (cachedDependenciesPromise === undefined) {
    cachedDependenciesPromise = loadDefaultGitRunnerDependencies().then((result) => {
      cachedDependencies = result;
      cachedDependenciesPromise = undefined;
      return result;
    });
  }

  return cachedDependenciesPromise;
}
