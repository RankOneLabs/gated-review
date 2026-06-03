import { err, ok, type Result } from '#root/src/result.js';
import { createGitHubError, type GitHubError } from '#root/src/github/errors.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';
import { readGitHubErrorMessage } from '#root/src/github/response-error.js';

export type GitHubGraphQLPrimitive = string | number | boolean | null;
export type GitHubGraphQLValue = GitHubGraphQLPrimitive | ReadonlyArray<unknown> | Readonly<Record<string, unknown>>;

export type GitHubGraphQLVariables = Readonly<Record<string, GitHubGraphQLValue>>;

export type GitHubGraphQLRequest<TData, TVariables extends GitHubGraphQLVariables = GitHubGraphQLVariables> =
  Readonly<{
    operationName: string;
    requestLabel: string;
    query: string;
    variables?: TVariables;
  }>;

export type GitHubGraphQLErrorEntry = Readonly<{
  message: string;
  extensions?: Readonly<Record<string, unknown>>;
  path?: ReadonlyArray<string | number>;
}>;

export type GitHubGraphQLResponse<TData> = Readonly<{
  data?: TData;
  errors?: ReadonlyArray<GitHubGraphQLErrorEntry>;
}>;

export type GitHubGraphQLClient = {
  request<TData, TVariables extends GitHubGraphQLVariables = GitHubGraphQLVariables>(
    request: GitHubGraphQLRequest<TData, TVariables>
  ): Promise<Result<TData, GitHubError>>;
};

export type GitHubGraphQLClientDependencies = {
  fetch?: GitHubFetch;
};

export type GitHubGraphQLClientOptions = {
  graphqlUrl: string;
  installationId: number;
  tokenProvider: GitHubInstallationTokenProvider;
};

function extractGraphQLErrorMessage(response: GitHubGraphQLResponse<unknown>) {
  const firstError = response.errors?.[0];
  if (firstError === undefined) {
    return 'GitHub GraphQL request failed.';
  }

  return firstError.message || 'GitHub GraphQL request failed.';
}

export function createGitHubGraphQLClient(
  options: GitHubGraphQLClientOptions,
  dependencies: GitHubGraphQLClientDependencies = {}
): GitHubGraphQLClient {
  const fetchFn: GitHubFetch = dependencies.fetch ?? globalThis.fetch;

  return {
    async request<TData, TVariables extends GitHubGraphQLVariables = GitHubGraphQLVariables>(
      request: GitHubGraphQLRequest<TData, TVariables>
    ) {
      const token = await options.tokenProvider.getInstallationToken(options.installationId);
      if (!token.ok) {
        return err(token.error);
      }

      let response: Response;
      try {
        response = await fetchFn(options.graphqlUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token.value}`,
            'Content-Type': 'application/json',
            'User-Agent': 'gated-review',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify({
            operationName: request.operationName,
            query: request.query,
            variables: request.variables ?? {}
          })
        });
      } catch {
        return err(
          createGitHubError({
            category: 'transport',
            operation: request.operationName,
            requestLabel: request.requestLabel,
            message: 'GitHub GraphQL request failed.'
          })
        );
      }

      if (!response.ok) {
        return err(
          createGitHubError({
            category: 'graphql',
            operation: request.operationName,
            requestLabel: request.requestLabel,
            status: response.status,
            message: await readGitHubErrorMessage(response)
          })
        );
      }

      let body: GitHubGraphQLResponse<TData>;
      try {
        body = (await response.json()) as GitHubGraphQLResponse<TData>;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        return err(
          createGitHubError({
            category: 'graphql',
            operation: request.operationName,
            requestLabel: request.requestLabel,
            status: response.status,
            message: `GitHub GraphQL response was not valid JSON: ${detail}`
          })
        );
      }

      if (body.errors !== undefined && body.errors.length > 0) {
        return err(
          createGitHubError({
            category: 'graphql',
            operation: request.operationName,
            requestLabel: request.requestLabel,
            status: response.status,
            message: extractGraphQLErrorMessage(body)
          })
        );
      }

      if (body.data === undefined) {
        return err(
          createGitHubError({
            category: 'graphql',
            operation: request.operationName,
            requestLabel: request.requestLabel,
            status: response.status,
            message: 'GitHub GraphQL response was missing data.'
          })
        );
      }

      return ok(body.data);
    }
  };
}
