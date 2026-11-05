import { describe, expect, it } from 'vitest';

import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import type { GitHubGraphQLRequest } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { getPrStatus } from '#root/src/tools/read-model/pr-status.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import { createInMemoryFreshnessStore } from '#root/src/tools/freshness-store.js';
import { getReviewRoundOutputSchema } from '#root/src/tools/schemas.js';
import {
  prStatusLabelsQuery,
  prStatusQuery,
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery,
  type GraphQLReviewCommentNode,
  type GraphQLReviewThreadNode
} from '#root/src/tools/read-model/graphql-queries.js';
import { expectedTriagePrompt } from '#root/test/fixtures/review-triage-prompt.js';

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
                  state: 'OPEN',
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
                  state: 'OPEN',
                  url: 'https://github.com/openai/gated-review/pull/42',
                  isDraft: false,
                  headRepositoryOwner: { login: 'openai' },
                  headRefName: 'feature',
                  headRefOid: 'head-sha-123',
                  baseRefName: 'main',
                  mergedAt: null,
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
      copilotReviewerLogin: 'github-copilot[bot]'
    } satisfies ToolExecutionContext
  };
}

describe('read-model integration', () => {
  it('includeResolved returns every comment across thread and comment page limits, including absent authors', async () => {
    const threads: GraphQLReviewThreadNode[] = Array.from({ length: 105 }, (_, index) => ({
      id: `thread-${index}`, isResolved: index % 3 !== 0, path: `src/file-${index}.ts`, line: index + 1
    }));
    const commentsByThread = new Map<string, GraphQLReviewCommentNode[]>(threads.map((thread) => [
      thread.id,
      Array.from({ length: 103 }, (_, index) => ({
        id: `${thread.id}-comment-${index}`, body: `Feedback ${index} for ${thread.id}`,
        createdAt: '2026-06-02T12:00:00.000Z', author: index % 13 === 0 ? null : { login: 'alice' }
      }))
    ]));
    const { context } = createMockContext();
    const graphql = createGitHubGraphQLClient({
      graphqlUrl: 'https://api.github.com/graphql', installationId: 99,
      tokenProvider: { async getInstallationToken() { return ok('test-token'); } }
    }, {
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as Pick<GitHubGraphQLRequest<unknown>, 'query' | 'variables'>;
        const offset = Number(request.variables?.after ?? 0);
        if (request.query === reviewRoundThreadsQuery) return jsonResponse({ data: { repository: { pullRequest: {
          state: 'OPEN', reviewThreads: {
            nodes: threads.slice(offset, offset + 100),
            pageInfo: { hasNextPage: offset + 100 < threads.length, endCursor: offset + 100 < threads.length ? String(offset + 100) : null }
          }
        } } } });
        if (request.query === reviewThreadCommentsQuery) {
          const threadId = request.variables?.id;
          if (typeof threadId !== 'string') throw new Error('Thread ID missing');
          const comments = commentsByThread.get(threadId);
          if (comments === undefined) throw new Error('Unknown thread');
          return jsonResponse({ data: { node: { comments: {
            nodes: comments.slice(offset, offset + 100),
            pageInfo: { hasNextPage: offset + 100 < comments.length, endCursor: offset + 100 < comments.length ? String(offset + 100) : null }
          } } } });
        }
        if (request.query === reviewRoundSummariesQuery) return jsonResponse({ data: { repository: { pullRequest: {
          comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
        } } } });
        throw new Error('Unexpected query');
      }
    });
    const sharedContext = { ...context, github: { ...context.github, graphql }, freshness: createInMemoryFreshnessStore() };
    const input = { repository: 'openai/gated-review', pullRequestNumber: 42, includeResolved: true };
    await getReviewRound(input, sharedContext);

    const result = await getReviewRound(input, sharedContext);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = getReviewRoundOutputSchema.parse(result.value);
      expect(output.threads.map((thread) => ({ id: thread.id, commentIds: thread.comments.map((comment) => comment.id) })))
        .toEqual(threads.map((thread) => ({ id: thread.id, commentIds: commentsByThread.get(thread.id)?.map((comment) => comment.id) })));
      expect(output.threads.flatMap((thread) => thread.comments)).toHaveLength(10_815);
      expect(output.threads[1].comments[0]).toMatchObject({ author: null, body: 'Feedback 0 for thread-1' });
    }
  });

  it.each([false, true])('returns complete review rounds through GitHub clients after repeated reads with includeResolved=%s', async (includeResolved) => {
    const { context } = createMockContext();
    const sharedContext = { ...context, freshness: createInMemoryFreshnessStore() };
    const input = { repository: 'openai/gated-review', pullRequestNumber: 42, includeResolved };

    const first = await getReviewRound(input, sharedContext);
    const second = await getReviewRound(input, sharedContext);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      const round = getReviewRoundOutputSchema.parse(second.value);
      expect(round.threads).toEqual(first.value.threads.map((thread) => ({
        ...thread,
        hasFreshComments: false
      })));
      expect(round.openThreadCount).toBe(1);
      expect(round.freshSince).toBe('2026-06-02T12:00:00.000Z');
    }
  });

  it('reads review rounds through the mocked GitHub clients', async () => {
    const { context, requests } = createMockContext();

    const result = await getReviewRound(
      {
        repository: 'openai/gated-review',
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
        freshSince: null,
        triagePrompt: expectedTriagePrompt,
        threads: [
          {
            id: 'thread-open',
            state: 'open',
            path: 'src/open.ts',
            line: 12,
            hasFreshComments: true,
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
      'ReviewRoundThreadsQuery',
      'ReviewThreadCommentsQuery',
      'ReviewRoundSummariesQuery'
    ]);
  });

  it('reads pr status through the mocked GitHub clients', async () => {
    const { context, requests } = createMockContext();

    const result = await getPrStatus(
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 42
      },
      context
    );

    expect(result).toEqual({
      ok: true,
      value: {
        pullRequestNumber: 42,
        state: 'OPEN',
        url: 'https://github.com/openai/gated-review/pull/42',
        isDraft: false,
        headOwner: 'openai',
        headBranch: 'feature',
        headSha: 'head-sha-123',
        baseBranch: 'main',
        mergedAt: null,
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
    ).toEqual(['PrStatusQuery', 'PrStatusLabelsQuery']);
    expect(
      requests.filter((entry) => entry.kind === 'rest').map((entry) => (entry.request as { method: string; url: string }).url)
    ).toContain('https://api.github.com/repos/openai/gated-review/commits/head-sha-123/status');
  });
});
