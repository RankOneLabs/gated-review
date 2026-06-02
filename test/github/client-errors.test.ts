import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';

describe('GitHub client error shaping', () => {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  it('returns shaped GraphQL errors without exposing request credentials', async () => {
    const client = createGitHubGraphQLClient(
      {
        graphqlUrl: 'https://api.github.com/graphql',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async (_url, init) =>
          new Response(
            JSON.stringify({
              errors: [{ message: 'Repository not found' }]
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          )
      }
    );

    const result = await client.request<{ repository: { id: string } }>({
      operationName: 'GetRepository',
      requestLabel: 'POST /graphql',
      query: 'query GetRepository { repository(name: "demo") { id } }'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'github_error',
        category: 'graphql',
        operation: 'GetRepository',
        message: 'Repository not found',
        requestLabel: 'POST /graphql',
        status: 200
      });
      expect(result.error).not.toHaveProperty('headers');
      expect(result.error).not.toHaveProperty('body');
    }
  });

  it('converts GraphQL transport failures into shaped errors', async () => {
    const client = createGitHubGraphQLClient(
      {
        graphqlUrl: 'https://api.github.com/graphql',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async () => {
          throw new Error('dns lookup failed');
        }
      }
    );

    const result = await client.request<{ repository: { id: string } }>({
      operationName: 'GetRepository',
      requestLabel: 'POST /graphql',
      query: 'query GetRepository { repository(name: "demo") { id } }'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'github_error',
        category: 'transport',
        operation: 'GetRepository',
        message: 'GitHub GraphQL request failed.',
        requestLabel: 'POST /graphql'
      });
    }
  });

  it('uses the explicit graphql url', async () => {
    const requestedUrls: Array<string> = [];
    const client = createGitHubGraphQLClient(
      {
        graphqlUrl: 'https://example.com/api/graphql',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response(
            JSON.stringify({
              data: {
                repository: { id: 'repo-1' }
              }
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }
      }
    );

    const result = await client.request<{ repository: { id: string } }>({
      operationName: 'GetRepository',
      requestLabel: 'POST /graphql',
      query: 'query GetRepository { repository(name: "demo") { id } }'
    });

    expect(result.ok).toBe(true);
    expect(requestedUrls).toEqual(['https://example.com/api/graphql']);
  });

  it('returns shaped REST errors without exposing response internals', async () => {
    const client = createGitHubRestClient(
      {
        baseUrl: 'https://api.github.com',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async (_url, init) =>
          new Response(
            JSON.stringify({
              message: 'Bad credentials',
              token: 'secret-token',
              headers: { authorization: 'bearer secret-token' }
            }),
            {
              status: 401,
              statusText: 'Unauthorized',
              headers: {
                'Content-Type': 'application/json'
              }
            }
          )
      }
    );

    const result = await client.createPullRequest(
      { owner: 'openai', repo: 'gated-review' },
      {
        title: 'Add feature',
        head: 'feature-branch',
        base: 'main'
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'github_error',
        category: 'rest',
        operation: 'create_pull_request',
        message: 'Bad credentials',
        requestLabel: 'POST /repos/openai/gated-review/pulls',
        status: 401
      });
      expect(result.error).not.toHaveProperty('headers');
      expect(result.error).not.toHaveProperty('token');
    }
  });

  it('sends repository scoped paths with path-prefixed api bases', async () => {
    const requestedUrls: Array<string> = [];
    const client = createGitHubRestClient(
      {
        baseUrl: 'https://example.com/api/v3',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response(
            JSON.stringify({ number: 1, html_url: 'https://example.com/pull/1', state: 'open' }),
            {
              status: 201,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }
      }
    );

    const result = await client.createPullRequest(
      { owner: 'openai', repo: 'gated-review' },
      {
        title: 'Add feature',
        head: 'feature-branch',
        base: 'main'
      }
    );

    expect(result.ok).toBe(true);
    expect(requestedUrls).toEqual(['https://example.com/api/v3/repos/openai/gated-review/pulls']);
  });
});
