import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';

/**
 * GitHub rejects a request whose `operationName` does not name an operation in the
 * document ("No operation named ..."). Tool call sites pass `operationName` as a
 * diagnostic label, so the client must send the operation name taken from the query
 * itself, not the label.
 */
describe('GraphQL wire operationName', () => {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  function captureBody() {
    const captured: { body: { operationName?: string } | null } = { body: null };
    const client = createGitHubGraphQLClient(
      { graphqlUrl: 'https://api.github.com/graphql', installationId: 99, tokenProvider },
      {
        fetch: async (_url, init) => {
          captured.body = JSON.parse(String(init?.body)) as { operationName?: string };
          return new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    );
    return { client, captured };
  }

  it('sends the query operation name, not the diagnostic label', async () => {
    const { client, captured } = captureBody();

    await client.request({
      operationName: 'pr_status', // snake_case label — must NOT reach the wire
      requestLabel: 'POST /graphql',
      query: 'query PrStatusQuery($n: Int!) { repository { pullRequest(number: $n) { id } } }'
    });

    expect(captured.body?.operationName).toBe('PrStatusQuery');
  });

  it('omits operationName for an anonymous operation', async () => {
    const { client, captured } = captureBody();

    await client.request({
      operationName: 'whatever',
      requestLabel: 'POST /graphql',
      query: '{ viewer { login } }'
    });

    expect(captured.body).not.toBeNull();
    expect(captured.body).not.toHaveProperty('operationName');
  });
});
