import { describe, expect, it, vi } from 'vitest';

import type { ReviewId } from '#root/src/domain.js';
import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { actorScopes } from '#root/src/tools/actors.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import {
  getReviewRoundInputSchema,
  getReviewRoundOutputSchema,
  prStatusInputSchema,
  prStatusOutputSchema,
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

function createMockContext(): ToolExecutionContext {
  const request = vi.fn(async (requestInput: { query: string; operationName?: string; variables?: Record<string, unknown> }) => {
    if (requestInput.operationName === 'AddPullRequestReviewThreadReply') {
      return ok({
        addPullRequestReviewThreadReply: {
          comment: {
            id: 'comment-123'
          }
        }
      });
    }

    if (requestInput.operationName === 'ResolveReviewThread') {
      return ok({
        resolveReviewThread: {
          thread: {
            id: 'thread-123'
          }
        }
      });
    }

    if (requestInput.query === reviewRoundThreadsQuery) {
      return ok({
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
      });
    }

    if (requestInput.query === reviewThreadCommentsQuery) {
      if (requestInput.variables?.id === 'thread-open') {
        return ok({
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
        });
      }
    }

    if (requestInput.query === reviewRoundSummariesQuery) {
      return ok({
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
                  createdAt: '2026-06-02T12:02:00.000Z',
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
      });
    }

    if (requestInput.query === prStatusQuery) {
      return ok({
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
      });
    }

    if (requestInput.query === prStatusLabelsQuery) {
      return ok({
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
      });
    }

    throw new Error(`Unexpected GraphQL request: ${requestInput.query}`);
  });

  const github = {
    graphql: {
      request
    },
    rest: {
      async createPullRequest() {
        return ok({
          number: 17,
          html_url: 'https://github.com/openai/gated-review/pull/17',
          state: 'open'
        });
      },
      async createIssueComment() {
        return ok({
          id: 123
        });
      },
      async getCommitCombinedStatus() {
        return ok({
          state: 'failure',
          statuses: [
            { context: 'lint', state: 'success' },
            { context: 'tests', state: 'failure' },
            { context: 'docs', state: 'pending' }
          ]
        });
      }
    }
  } as unknown as ToolExecutionContext['github'];

  return {
    github,
    repository: { owner: 'openai', repo: 'gated-review' }
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

  it('returns result values with domain errors or shaped outputs for every tool', async () => {
    const toolRegistry = createToolRegistry(createMockContext());
    const results = await Promise.all(
      toolRegistry.map(async (tool) => {
        const input = tool.inputSchema.parse(
          tool.name === 'review.record_event'
            ? {
                reviewId: 'review-123',
                event: {
                  eventType: 'sync.completed',
                  payload: { status: 'done' }
                }
              }
            : tool.name === 'review.apply_decision'
              ? {
                  reviewId: 'review-123',
                  decision: 'approve',
                  reason: 'policy satisfied'
                }
              : tool.name === 'open_pr'
                ? {
                    base: 'main',
                    head: 'feature-branch',
                    title: 'Add feature',
                    body: 'Ship it',
                    draft: true
                  }
                : tool.name === 'reply_to_thread'
                  ? {
                      threadId: 'thread-123',
                      body: 'Acknowledged'
                    }
                  : tool.name === 'resolve_thread'
                    ? {
                        threadId: 'thread-123'
                      }
                    : tool.name === 'request_next_round'
                      ? {
                          pullRequestNumber: 17
                        }
                      : tool.name === 'get_review_round' || tool.name === 'pr_status'
                        ? {
                            pullRequestNumber: 42
                          }
                        : {
                            reviewId: 'review-123'
                          }
        );

        return {
          tool,
          result: await tool.handler(input)
        };
      })
    );

    expect(results).toHaveLength(toolRegistry.length);
    for (const { tool, result } of results) {
      if (tool.name === 'open_pr') {
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
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe('not_implemented');
          expect(result.error.operation).toMatch(/^review\./);
          expect(result.error.entity).toEqual({ kind: 'tool', name: result.error.operation });
        }
      }
    }
  });
});
