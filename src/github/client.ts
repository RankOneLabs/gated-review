import { err, ok, type Result } from '#root/src/result.js';
import type { GitHubAppConfig } from '#root/src/config.js';
import { createGitHubAppAuth } from '#root/src/auth/github-app.js';
import { GitHubInstallationTokenCache } from '#root/src/auth/token-cache.js';
import type { GitHubError } from '#root/src/github/errors.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';

export type GitHubClient = Readonly<{
  installationId: number;
  apiBaseUrl: string;
  graphql: ReturnType<typeof createGitHubGraphQLClient>;
  rest: ReturnType<typeof createGitHubRestClient>;
}>;

export type GitHubClientDependencies = Readonly<{
  fetch?: GitHubFetch;
  now?: () => number;
}>;

export function createGitHubClient(
  config: GitHubAppConfig,
  dependencies: GitHubClientDependencies = {}
): Result<GitHubClient, GitHubError> {
  const auth = createGitHubAppAuth(config, dependencies);
  if (!auth.ok) {
    return err(auth.error);
  }

  const tokenCache = new GitHubInstallationTokenCache(auth.value, {
    now: dependencies.now
  });

  const graphql = createGitHubGraphQLClient(
    {
      baseUrl: config.apiBaseUrl,
      installationId: config.installationId,
      tokenProvider: tokenCache
    },
    dependencies
  );

  const rest = createGitHubRestClient(
    {
      baseUrl: config.apiBaseUrl,
      installationId: config.installationId,
      tokenProvider: tokenCache
    },
    dependencies
  );

  return ok({
    installationId: config.installationId,
    apiBaseUrl: config.apiBaseUrl,
    graphql,
    rest
  });
}
