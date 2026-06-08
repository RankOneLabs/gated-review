import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import { createRequestNextRoundHandler } from '#root/src/tools/mutations/request-next-round.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';

describe('request_next_round', () => {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  it('requests the configured Copilot reviewer on the pull request', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const rest = createGitHubRestClient(
      {
        baseUrl: 'https://api.github.com',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async (input, init) => {
          requests.push({
            url: String(input),
            body: JSON.parse(String(init?.body))
          });
          return new Response(
            JSON.stringify({
              number: 17,
              requested_reviewers: [{ login: 'github-copilot[bot]' }],
              requested_teams: []
            }),
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
    const graphql = createGitHubGraphQLClient(
      {
        graphqlUrl: 'https://api.github.com/graphql',
        installationId: 99,
        tokenProvider
      },
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              data: {}
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

    const copilotReviewerLogin = 'github-copilot[bot]';
    const handler = createRequestNextRoundHandler({
      github: {
        installationId: 99,
        apiBaseUrl: 'https://api.github.com',
        graphqlUrl: 'https://api.github.com/graphql',
        graphql,
        rest
      },
      copilotReviewerLogin
    });

    const result = await handler({
      repository: 'openai/gated-review',
      pullRequestNumber: 17
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        ok: true
      });
    }
    expect(requests).toEqual([
      {
        url: 'https://api.github.com/repos/openai/gated-review/pulls/17/requested_reviewers',
        body: {
          reviewers: [copilotReviewerLogin]
        }
      }
    ]);
  });
});
