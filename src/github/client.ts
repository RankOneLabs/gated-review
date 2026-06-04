import { err, ok, type Result } from '#root/src/result.js';
import type { GitHubAppConfig } from '#root/src/config.js';
import { createGitHubAppAuth } from '#root/src/auth/github-app.js';
import { GitHubInstallationTokenCache } from '#root/src/auth/token-cache.js';
import { GitHubInstallationResolver } from '#root/src/auth/installation-resolver.js';
import type { GitHubError } from '#root/src/github/errors.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient, type InstallationIdResolver } from '#root/src/github/rest.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';

export type GitHubClient = Readonly<{
  installationId?: number;
  apiBaseUrl: string;
  graphqlUrl: string;
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

  // With a fixed installation id we stay in single-account mode (legacy). Without
  // one, resolve the installation per repository owner so a single deployment can
  // serve repos across multiple accounts.
  const resolver = new GitHubInstallationResolver(auth.value);
  const resolveInstallationId: InstallationIdResolver | undefined =
    config.installationId === undefined
      ? (owner, repo) => resolver.resolveInstallationId(owner, repo)
      : undefined;

  const graphql = createGitHubGraphQLClient(
    {
      graphqlUrl: config.graphqlUrl,
      installationId: config.installationId,
      resolveInstallationId,
      tokenProvider: tokenCache
    },
    dependencies
  );

  const rest = createGitHubRestClient(
    {
      baseUrl: config.apiBaseUrl,
      installationId: config.installationId,
      resolveInstallationId,
      tokenProvider: tokenCache
    },
    dependencies
  );

  return ok({
    installationId: config.installationId,
    apiBaseUrl: config.apiBaseUrl,
    graphqlUrl: config.graphqlUrl,
    graphql,
    rest
  });
}
