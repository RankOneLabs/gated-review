import { describe, expect, it } from 'vitest';

import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { getPrStatus } from '#root/src/tools/read-model/pr-status.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import {
  prStatusLabelsQuery,
  prStatusQuery,
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery
} from '#root/src/tools/read-model/graphql-queries.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function createMockContext() {
  const requests: Array<{ kind: 'graphql' | 'rest'; request: unknown }> = [];
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('installation-token');
    }
  };

  const graphql = createGitHubGraphQLClient(
    {
      graphqlUrl: 'https://api.github.com/graphql',
      installationId: 99,
      tokenProvider
    },
    {
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operationName: string; query: string; variables: Record<string, unknown> };
        requests.push({
          kind: 'graphql',
          request
        });

        if (request.query === reviewRoundThreadsQuery) {
          return jsonResponse({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [
                      {
                        id: 'thread-open',
                        isResolved: false,
                        path: 'src/open.ts',
                        line: 12
                      },
                      {
                        id: 'thread-resolved',
                        isResolved: true,
                        path: 'src/resolved.ts',
                        line: null
                      }
                    ],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            }
          });
        }

        if (request.query === reviewThreadCommentsQuery) {
          return jsonResponse({
            data: {
              node: {
                comments: {
                  nodes: [
                    {
                      id: 'comment-1',
                      body: 'please adjust',
                      createdAt: '2026-06-02T12:00:00.000Z',
                      author: {
                        login: 'alice'
                      }
                    }
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          });
        }

        if (request.query === reviewRoundSummariesQuery) {
          return jsonResponse({
            data: {
              repository: {
                pullRequest: {
                  comments: {
                    nodes: [
                      {
                        id: 'summary-1',
                        body: 'review summary',
                        createdAt: '2026-06-02T12:01:00.000Z',
                        author: {
                          login: 'coderabbitai[bot]'
                        }
                      },
                      {
                        id: 'summary-ignored',
                        body: 'human comment',
                        createdAt: '2026-06-02T12:01:30.000Z',
                        author: {
                          login: 'dave'
                        }
                      }
                    ],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            }
          });
        }

        if (request.query === prStatusQuery) {
          return jsonResponse({
            data: {
              repository: {
                pullRequest: {
                  headRefOid: 'head-sha-123',
                  reviewThreads: {
                    nodes: [
                      { isResolved: false },
                      { isResolved: true }
                    ],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            }
          });
        }

        if (request.query === prStatusLabelsQuery) {
          return jsonResponse({
            data: {
              repository: {
                pullRequest: {
                  labels: {
                    nodes: [{ name: 'merge-ready' }],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            }
          });
        }

        throw new Error(`Unexpected GraphQL query: ${request.operationName}`);
      }
    }
  );

  const rest = createGitHubRestClient(
    {
      baseUrl: 'https://api.github.com',
      installationId: 99,
      tokenProvider
    },
    {
      fetch: async (input, init) => {
        requests.push({
          kind: 'rest',
          request: {
            url: String(input),
            method: init?.method ?? 'GET',
            body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
          }
        });

        const url = String(input);
        if (url.endsWith('/commits/head-sha-123/status')) {
          return jsonResponse({
            state: 'failure',
            statuses: [
              { context: 'lint', state: 'success' },
              { context: 'tests', state: 'failure' },
              { context: 'docs', state: 'pending' }
            ]
          });
        }

        return jsonResponse({});
      }
    }
  );

  return {
    requests,
    context: {
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
      },
      copilotReviewerLogin: 'github-copilot[bot]'
    } satisfies ToolExecutionContext
  };
}

describe('read-model integration', () => {
  it('reads review rounds through the mocked GitHub clients', async () => {
    const { context, requests } = createMockContext();

    const result = await getReviewRound(
      {
        pullRequestNumber: 42
      },
      context
    );

    expect(result).toEqual({
      ok: true,
      value: {
        pullRequestNumber: 42,
        includeResolved: false,
        openThreadCount: 1,
        threads: [
          {
            id: 'thread-open',
            state: 'open',
            path: 'src/open.ts',
            line: 12,
            comments: [
              {
                id: 'comment-1',
                body: 'please adjust',
                createdAt: '2026-06-02T12:00:00.000Z',
                author: {
                  login: 'alice',
                  kind: 'human'
                }
              }
            ]
          }
        ],
        summaries: [
          {
            id: 'summary-1',
            body: 'review summary',
            createdAt: '2026-06-02T12:01:00.000Z',
            author: {
              login: 'coderabbitai[bot]',
              kind: 'coderabbit'
            }
          }
        ]
      }
    });

    expect(
      requests.filter((entry) => entry.kind === 'graphql').map((entry) => (entry.request as { operationName: string }).operationName)
    ).toEqual([
      'get_review_round',
      'get_review_round',
      'get_review_round'
    ]);
  });

  it('reads pr status through the mocked GitHub clients', async () => {
    const { context, requests } = createMockContext();

    const result = await getPrStatus(
      {
        pullRequestNumber: 42
      },
      context
    );

    expect(result).toEqual({
      ok: true,
      value: {
        pullRequestNumber: 42,
        openThreadCount: 1,
        mergeReady: {
          isReady: true,
          source: 'github_label',
          label: 'merge-ready'
        },
        checks: {
          state: 'failing',
          totalCount: 3,
          failingCount: 1,
          pendingCount: 1,
          contexts: [
            { context: 'lint', state: 'success' },
            { context: 'tests', state: 'failure' },
            { context: 'docs', state: 'pending' }
          ]
        }
      }
    });

    expect(
      requests.filter((entry) => entry.kind === 'graphql').map((entry) => (entry.request as { operationName: string }).operationName)
    ).toEqual(['pr_status', 'merge_ready']);
    expect(
      requests.filter((entry) => entry.kind === 'rest').map((entry) => (entry.request as { method: string; url: string }).url)
    ).toContain('https://api.github.com/repos/openai/gated-review/commits/head-sha-123/status');
  });
});
