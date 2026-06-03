import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import { createOpenPrHandler } from '#root/src/tools/mutations/open-pr.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';

describe('open_pr', () => {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  it('creates a pull request within the configured repository scope', async () => {
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
              html_url: 'https://github.com/openai/gated-review/pull/17',
              state: 'open'
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

    const handler = createOpenPrHandler({
      github: {
        installationId: 99,
        apiBaseUrl: 'https://api.github.com',
        graphqlUrl: 'https://api.github.com/graphql',
        graphql,
        rest
      },
      copilotReviewerLogin: 'github-copilot[bot]'
    });

    const result = await handler({
      repository: 'openai/gated-review',
      base: 'main',
      head: 'feature-branch',
      title: 'Add feature',
      body: 'Ship it',
      draft: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        number: 17,
        url: 'https://github.com/openai/gated-review/pull/17',
        state: 'open'
      });
    }
    expect(requests).toEqual([
      {
        url: 'https://api.github.com/repos/openai/gated-review/pulls',
        body: {
          title: 'Add feature',
          head: 'feature-branch',
          base: 'main',
          body: 'Ship it',
          draft: true
        }
      }
    ]);
  });
});
