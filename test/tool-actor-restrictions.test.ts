import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import { createToolRegistry } from '#root/src/tools/registry.js';

function createMockContext() {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  const rest = createGitHubRestClient(
    {
      baseUrl: 'https://api.github.com',
      installationId: 99,
      tokenProvider
    },
    {
      fetch: async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        })
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
            data: {
              repository: {
                pullRequest: {
                  labels: {
                    nodes: [],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
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
        )
    }
  );

  return {
    github: {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql,
      rest
    },
    repository: {
      owner: 'openai',
      repo: 'gated-review'
    }
  };
}

function toolNamesForScope(scope: 'agent' | 'operator' | 'event_source') {
  return createToolRegistry(createMockContext())
    .filter((tool) => tool.actorScopes.some((actorScope) => actorScope === scope))
    .map((tool) => tool.name);
}

describe('tool actor restrictions', () => {
  it('keeps merge controls operator-only', () => {
    expect(toolNamesForScope('operator')).toEqual(
      expect.arrayContaining(['request_copilot_review', 'mark_merge_ready', 'merge_pr'])
    );
  });

  it('keeps merge controls out of the agent scope', () => {
    expect(toolNamesForScope('agent')).not.toContain('request_copilot_review');
    expect(toolNamesForScope('agent')).not.toContain('mark_merge_ready');
    expect(toolNamesForScope('agent')).not.toContain('merge_pr');
  });

  it('keeps merge controls out of the event_source scope', () => {
    expect(toolNamesForScope('event_source')).not.toContain('request_copilot_review');
    expect(toolNamesForScope('event_source')).not.toContain('mark_merge_ready');
    expect(toolNamesForScope('event_source')).not.toContain('merge_pr');
  });
});
