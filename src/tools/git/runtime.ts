import { createGitHubAppAuth } from '#root/src/auth/github-app.js';
import { GitHubInstallationTokenCache } from '#root/src/auth/token-cache.js';
import { loadGitHubAppConfig } from '#root/src/config.js';
import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { GitRunnerDependencies } from '#root/src/tools/git/runner.js';

let cachedDependencies: Result<GitRunnerDependencies, ToolDomainError> | undefined;
let cachedDependenciesPromise: Promise<Result<GitRunnerDependencies, ToolDomainError>> | undefined;

function toRuntimeError(detail: string): ToolDomainError {
  return validationRejectedError('git.runtime', detail);
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

  return ok({
    installationId: config.value.installationId,
    tokenProvider: new GitHubInstallationTokenCache(auth.value)
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
