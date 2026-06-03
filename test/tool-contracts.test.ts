import { describe, expect, it, vi } from 'vitest';

import type { ReviewId } from '#root/src/domain.js';
import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { actorScopes } from '#root/src/tools/actors.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import {
  getReviewRoundInputSchema,
  getReviewRoundOutputSchema,
  markMergeReadyInputSchema,
  markMergeReadyOutputSchema,
  mergePrInputSchema,
  mergePrOutputSchema,
  prStatusInputSchema,
  prStatusOutputSchema,
  requestCopilotReviewInputSchema,
  requestCopilotReviewOutputSchema,
  reviewActionSchema,
  reviewDecisionInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema
} from '#root/src/tools/schemas.js';
import {
  prStatusLabelsQuery,
  prStatusQuery,
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery
} from '#root/src/tools/read-model/graphql-queries.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import type { ToolContract } from '#root/src/tools/types.js';
import type { ZodTypeAny } from 'zod';

const defaultInputFixture = { reviewId: 'review-123' };

const inputFixtures: Readonly<Record<string, unknown>> = {
  'review.record_event': {
    reviewId: 'review-123',
    event: {
      eventType: 'sync.completed',
      payload: { status: 'done' }
    }
  },
  'review.apply_decision': {
    reviewId: 'review-123',
    decision: 'approve',
    reason: 'policy satisfied'
  },
  open_pr: {
    base: 'main',
    head: 'feature-branch',
    title: 'Add feature',
    body: 'Ship it',
    draft: true
  },
  reply_to_thread: {
    threadId: 'thread-123',
    body: 'Acknowledged'
  },
  resolve_thread: {
    threadId: 'thread-123'
  },
  request_next_round: {
    pullRequestNumber: 17
  },
  request_copilot_review: {
    pullRequestNumber: 42
  },
  mark_merge_ready: {
    pullRequestNumber: 42,
    ready: true
  },
  merge_pr: {
    pullRequestNumber: 42,
    mergeMethod: 'squash',
    commitTitle: 'Merge pull request #42',
    commitMessage: 'Gate satisfied',
    sha: 'head-sha-123'
  },
  get_review_round: {
    pullRequestNumber: 42
  },
  pr_status: {
    pullRequestNumber: 42
  }
};

function createMockContext(): ToolExecutionContext {
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
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/pulls')) {
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

        if (url.endsWith('/requested_reviewers')) {
          const body = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              number: 17,
              requested_reviewers: (body.reviewers as string[]).map((login) => ({ login })),
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

        if (url.endsWith('/comments')) {
          return new Response(
            JSON.stringify({
              id: 123,
              body: JSON.parse(String(init?.body)).body,
              html_url: 'https://github.com/openai/gated-review/pull/17#issuecomment-123'
            }),
            {
              status: 201,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        if (url.endsWith('/labels/merge-ready') && init?.method === 'GET') {
          return new Response(JSON.stringify({ message: 'Not Found' }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json'
            }
          });
        }

        if (url.endsWith('/labels') && init?.method === 'POST') {
          const body = JSON.parse(String(init?.body));
          if (Array.isArray(body.labels)) {
            return new Response(
              JSON.stringify(
                body.labels.map((name: string, index: number) => ({
                  id: index + 1,
                  name,
                  color: 'c2e0c6'
                }))
              ),
              {
                status: 200,
                headers: {
                  'Content-Type': 'application/json'
                }
              }
            );
          }

          return new Response(
            JSON.stringify({
              id: 1,
              name: body.name,
              color: body.color,
              description: body.description
            }),
            {
              status: 201,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        if (url.endsWith('/labels/merge-ready') && init?.method === 'DELETE') {
          return new Response(null, {
            status: 204
          });
        }

        if (url.endsWith('/merge')) {
          return new Response(
            JSON.stringify({
              merged: true,
              sha: 'merge-sha-123',
              message: 'Merged'
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        return new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    }
  );
  rest.getCommitCombinedStatus = vi.fn(async () =>
    ok({
      state: 'failure',
      statuses: [
        { context: 'lint', state: 'success' },
        { context: 'tests', state: 'failure' },
        { context: 'docs', state: 'pending' }
      ]
    })
  );
  const graphql = createGitHubGraphQLClient(
    {
      graphqlUrl: 'https://api.github.com/graphql',
      installationId: 99,
      tokenProvider
    },
    {
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        if (request.operationName === 'add_pull_request_review_thread_reply') {
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

        if (request.query === reviewRoundThreadsQuery) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        if (request.query === reviewThreadCommentsQuery) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        if (request.query === reviewRoundSummariesQuery) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        if (request.query === prStatusQuery) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        if (request.query === prStatusLabelsQuery) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

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

  return {
    github: {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql,
      rest
    },
    repository: { owner: 'openai', repo: 'gated-review' },
    copilotReviewerLogin: 'github-copilot[bot]'
  };
}

async function runStubHandler(tool: ToolContract<ZodTypeAny, ZodTypeAny, string>) {
  const input = tool.inputSchema.parse(inputFixtures[tool.name] ?? defaultInputFixture);

  return {
    tool,
    result: await tool.handler(input)
  };
}

describe('tool contracts', () => {
  it('exposes the curated tool surface', () => {
    expect(createToolRegistry(createMockContext()).map((tool) => tool.name)).toEqual([
      'review.get_state',
      'review.list_actions',
      'review.record_event',
      'review.apply_decision',
      'open_pr',
      'reply_to_thread',
      'resolve_thread',
      'request_next_round',
      'request_copilot_review',
      'mark_merge_ready',
      'merge_pr',
      'git.push',
      'git.pull',
      'git.fetch',
      'get_review_round',
      'pr_status'
    ]);
    expect(createToolRegistry(createMockContext()).map((tool) => tool.name)).not.toContain('github_raw');
  });

  it('publishes actor scope metadata for each tool', () => {
    const toolRegistry = createToolRegistry(createMockContext());
    expect(toolRegistry.find((tool) => tool.name === 'review.get_state')?.actorScopes).toEqual(
      actorScopes
    );
    expect(toolRegistry.find((tool) => tool.name === 'review.list_actions')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'review.record_event')?.actorScopes).toEqual([
      'event_source'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'review.apply_decision')?.actorScopes).toEqual([
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'open_pr')?.actorScopes).toEqual(['agent']);
    expect(toolRegistry.find((tool) => tool.name === 'reply_to_thread')?.actorScopes).toEqual([
      'agent'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'resolve_thread')?.actorScopes).toEqual([
      'agent'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'request_next_round')?.actorScopes).toEqual([
      'agent'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'request_copilot_review')?.actorScopes).toEqual([
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'mark_merge_ready')?.actorScopes).toEqual([
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'merge_pr')?.actorScopes).toEqual(['operator']);
    expect(toolRegistry.find((tool) => tool.name === 'git.push')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'git.pull')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'git.fetch')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'get_review_round')?.actorScopes).toEqual([
      'agent',
      'event_source'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'pr_status')?.actorScopes).toEqual([
      'agent',
      'operator',
      'event_source'
    ]);
  });

  it('keeps the shaped output schema names explicit', () => {
    expect(createToolRegistry(createMockContext()).map((tool) => tool.outputSchemaName)).toEqual([
      'review.get_state.output',
      'review.list_actions.output',
      'review.record_event.output',
      'review.apply_decision.output',
      'open_pr.output',
      'reply_to_thread.output',
      'resolve_thread.output',
      'request_next_round.output',
      'request_copilot_review.output',
      'mark_merge_ready.output',
      'merge_pr.output',
      'git.push.output',
      'git.pull.output',
      'git.fetch.output',
      'get_review_round.output',
      'pr_status.output'
    ]);
  });

  it('accepts shaped payloads for the read-model tools', () => {
    expect(getReviewRoundInputSchema.parse({ pullRequestNumber: 42 })).toEqual({
      pullRequestNumber: 42
    });
    expect(
      getReviewRoundOutputSchema.parse({
        pullRequestNumber: 42,
        includeResolved: false,
        openThreadCount: 1,
        threads: [
          {
            id: 'thread-1',
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
      })
    ).toEqual({
      pullRequestNumber: 42,
      includeResolved: false,
      openThreadCount: 1,
      threads: [
        {
          id: 'thread-1',
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
    });

    expect(prStatusInputSchema.parse({ pullRequestNumber: 42 })).toEqual({
      pullRequestNumber: 42
    });
    expect(
      prStatusOutputSchema.parse({
        pullRequestNumber: 42,
        openThreadCount: 1,
        mergeReady: {
          isReady: true,
          source: 'github_label',
          label: 'merge-ready'
        },
        checks: {
          state: 'passing',
          totalCount: 1,
          failingCount: 0,
          pendingCount: 0,
          contexts: [{ context: 'lint', state: 'success' }]
        }
      })
    ).toEqual({
      pullRequestNumber: 42,
      openThreadCount: 1,
      mergeReady: {
        isReady: true,
        source: 'github_label',
        label: 'merge-ready'
      },
      checks: {
        state: 'passing',
        totalCount: 1,
        failingCount: 0,
        pendingCount: 0,
        contexts: [{ context: 'lint', state: 'success' }]
      }
    });
  });

  it('keeps the operator tool schemas shaped for merge control', () => {
    expect(requestCopilotReviewInputSchema.parse({ pullRequestNumber: 42 })).toEqual({
      pullRequestNumber: 42
    });
    expect(requestCopilotReviewOutputSchema.parse({ ok: true })).toEqual({ ok: true });

    expect(
      markMergeReadyInputSchema.parse({
        pullRequestNumber: 42,
        ready: true
      })
    ).toEqual({
      pullRequestNumber: 42,
      ready: true
    });
    expect(markMergeReadyOutputSchema.parse({ ok: true })).toEqual({ ok: true });

    expect(
      mergePrInputSchema.parse({
        pullRequestNumber: 42,
        mergeMethod: 'squash',
        commitTitle: 'Merge pull request #42',
        commitMessage: 'Gate satisfied',
        sha: 'head-sha-123'
      })
    ).toEqual({
      pullRequestNumber: 42,
      mergeMethod: 'squash',
      commitTitle: 'Merge pull request #42',
      commitMessage: 'Gate satisfied',
      sha: 'head-sha-123'
    });
    expect(mergePrOutputSchema.parse({ merged: true, sha: 'merge-sha-123' })).toEqual({
      merged: true,
      sha: 'merge-sha-123'
    });
  });

  it('brands the domain ids in the schema output types', () => {
    const state = reviewStateInputSchema.parse({ reviewId: 'review-123' });
    const stateReviewId: ReviewId = state.reviewId;

    const action = reviewActionSchema.parse({
      actionId: 'action-123',
      kind: 'comment',
      actorScope: 'operator',
      createdAt: '2026-06-02T12:00:00.000Z'
    });
    const actionId = action.actionId;

    const event = reviewEventReceiptOutputSchema.parse({
      reviewId: 'review-123',
      eventId: 'event-123',
      accepted: true,
      receivedAt: '2026-06-02T12:00:00.000Z'
    });
    const eventId = event.eventId;

    const decision = reviewDecisionInputSchema.parse({
      reviewId: 'review-123',
      decision: 'approve',
      reason: 'looks good'
    });
    const decisionReviewId: ReviewId = decision.reviewId;

    expect(stateReviewId).toBe('review-123');
    expect(actionId).toBe('action-123');
    expect(eventId).toBe('event-123');
    expect(decisionReviewId).toBe('review-123');
  });

  it('returns result values with domain errors for the non-git stub handlers', async () => {
    const toolRegistry = createToolRegistry(createMockContext());
    const stubTools = toolRegistry.filter((tool) => !tool.name.startsWith('git.')) as readonly ToolContract<
      ZodTypeAny,
      ZodTypeAny,
      string
    >[];
    const results = await Promise.all(stubTools.map(async (tool) => runStubHandler(tool)));

    expect(results).toHaveLength(stubTools.length);
    for (const { tool, result } of results) {
      if (tool.name.startsWith('review.')) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe('not_implemented');
          expect(result.error.operation).toMatch(/^review\./);
          expect(result.error.entity).toEqual({ kind: 'tool', name: result.error.operation });
        }
      } else if (tool.name === 'open_pr') {
        expect(result).toEqual({
          ok: true,
          value: {
            number: 17,
            url: 'https://github.com/openai/gated-review/pull/17',
            state: 'open'
          }
        });
      } else if (
        tool.name === 'reply_to_thread' ||
        tool.name === 'resolve_thread' ||
        tool.name === 'request_next_round'
      ) {
        expect(result).toEqual({ ok: true, value: { ok: true } });
      } else if (tool.name === 'get_review_round') {
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
      } else if (tool.name === 'pr_status') {
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
      } else if (tool.name === 'request_copilot_review') {
        expect(result).toEqual({ ok: true, value: { ok: true } });
      } else if (tool.name === 'mark_merge_ready') {
        expect(result).toEqual({ ok: true, value: { ok: true } });
      } else if (tool.name === 'merge_pr') {
        expect(result).toEqual({
          ok: true,
          value: {
            merged: true,
            sha: 'merge-sha-123'
          }
        });
      } else {
        expect(result.ok).toBe(false);
      }
    }
  });
});
