import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { addPullRequestReviewThreadReply } from '#root/src/tools/mutations/graphql-mutations.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';

describe('addPullRequestReviewThreadReply', () => {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  it('posts a thread reply mutation with the supplied thread id and body', async () => {
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
                addPullRequestReviewThreadReply: {
                  comment: {
                    id: 'comment-123'
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

    const result = await addPullRequestReviewThreadReply(client, {
      threadId: 'thread-123',
      body: 'Acknowledged'
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual([
      {
        operationName: 'add_pull_request_review_thread_reply',
        query: expect.any(String),
        variables: {
          threadId: 'thread-123',
          body: 'Acknowledged'
        }
      }
    ]);
  });
});
