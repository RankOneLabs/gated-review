import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { resolveReviewThread } from '#root/src/tools/mutations/graphql-mutations.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';

describe('resolveReviewThread', () => {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  it('posts a thread resolution mutation with the supplied thread id', async () => {
    const requests: Array<unknown> = [];
    const client = createGitHubGraphQLClient(
      {
        graphqlUrl: 'https://api.github.com/graphql',
        installationId: 42,
        tokenProvider
      },
      {
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              data: {
                resolveReviewThread: {
                  thread: {
                    id: 'thread-123'
                  }
                }
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

    const result = await resolveReviewThread(client, {
      threadId: 'thread-123'
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual([
      {
        operationName: 'resolve_review_thread',
        query: expect.any(String),
        variables: {
          threadId: 'thread-123'
        }
      }
    ]);
  });
});
