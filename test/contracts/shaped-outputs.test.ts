import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import {
  getReviewRoundOutputSchema,
  markMergeReadyOutputSchema,
  mergePrOutputSchema,
  prStatusOutputSchema,
  requestCopilotReviewOutputSchema
} from '#root/src/tools/schemas.js';
import { openPrOutputSchema } from '#root/src/tools/mutations/open-pr.js';
import { requestNextRoundOutputSchema } from '#root/src/tools/mutations/request-next-round.js';
import { replyToThreadOutputSchema } from '#root/src/tools/mutations/reply-to-thread.js';
import { resolveThreadOutputSchema } from '#root/src/tools/mutations/resolve-thread.js';
import {
  prStatusLabelsQuery,
  prStatusQuery,
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery
} from '#root/src/tools/read-model/graphql-queries.js';

const expectedTriagePrompt = {
  instruction:
    'Triage every open review thread into exactly one bucket before acting. Treat summaries as context, not bucketed threads.',
  buckets: [
    {
      name: 'fix',
      description: 'Clear, correct feedback with an implementation path you can apply locally.'
    },
    {
      name: 'discuss',
      description: 'Ambiguous, architectural, disputed, or otherwise requiring operator input.'
    },
    {
      name: 'ignore',
      description: 'Nitpick, style preference, duplicate, or already addressed; resolve only after operator approval.'
    }
  ],
  presentation:
    'Present open threads grouped as Fix, Discuss, and Ignore. Include location, author, fresh marker, short comment summary, and proposed fix or reason.',
  approvalRequired:
    'Stop after presenting triage. Apply fixes, replies, ignores, and resolutions only after operator approval.'
};

function createMockContext(): ToolExecutionContext {
  const graphqlRequest = vi.fn(async (request: { operationName: string; query: string; variables?: Record<string, unknown> }) => {
    if (request.operationName === 'ReviewThreadRepository') {
      return ok({
        node: {
          pullRequest: {
            repository: {
              nameWithOwner: 'openai/gated-review'
            }
          }
        }
      });
    }

    if (request.operationName === 'AddPullRequestReviewThreadReply') {
      return ok({
        addPullRequestReviewThreadReply: {
          comment: {
            id: 'reply-1'
          }
        }
      });
    }

    if (request.operationName === 'ResolveReviewThread') {
      return ok({
        resolveReviewThread: {
          thread: {
            id: 'thread-1'
          }
        }
      });
    }

    if (request.query === reviewRoundThreadsQuery) {
      return ok({
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
      });
    }

    if (request.query === reviewThreadCommentsQuery) {
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

    if (request.query === reviewRoundSummariesQuery) {
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

    if (request.query === prStatusQuery) {
      return ok({
        repository: {
          pullRequest: {
            state: 'OPEN',
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

    if (request.query === prStatusLabelsQuery) {
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

    throw new Error(`Unexpected graphql request: ${request.operationName}`);
  });

  const rest = {
    createPullRequest: vi.fn(async () =>
      ok({
        number: 17,
        html_url: 'https://github.com/openai/gated-review/pull/17',
        state: 'open'
      })
    ),
    createIssueComment: vi.fn(async () =>
      ok({
        id: 123,
        body: '@coderabbitai review',
        html_url: 'https://github.com/openai/gated-review/pull/17#issuecomment-123'
      })
    ),
    requestPullRequestReviewers: vi.fn(async () =>
      ok({
        number: 17,
        requested_reviewers: [{ login: 'github-copilot[bot]' }],
        requested_teams: []
      })
    ),
    request: vi.fn(async (request: { method: string; path: string }) => {
      if (request.method === 'GET' && request.path.endsWith('/labels/merge-ready')) {
        return {
          ok: false as const,
          error: {
            kind: 'github_error',
            category: 'rest',
            operation: 'mark_merge_ready',
            message: 'Not Found',
            requestLabel: 'GET /repos/openai/gated-review/labels/merge-ready',
            status: 404
          }
        };
      }

      if (request.method === 'POST' && request.path.endsWith('/labels')) {
        return ok({
          id: 1,
          name: 'merge-ready',
          color: 'c2e0c6'
        });
      }

      if (request.method === 'DELETE' && request.path.endsWith('/labels/merge-ready')) {
        return ok(undefined);
      }

      return ok({
        id: 1,
        name: 'merge-ready',
        color: 'c2e0c6'
      });
    }),
    addIssueLabels: vi.fn(async () =>
      ok([
        {
          id: 1,
          name: 'merge-ready',
          color: 'c2e0c6'
        }
      ])
    ),
    mergePullRequest: vi.fn(async () =>
      ok({
        merged: true,
        sha: 'merge-sha-123',
        message: 'Merged'
      })
    ),
    getCommitCombinedStatus: vi.fn(async () =>
      ok({
        state: 'failure',
        statuses: [
          { context: 'lint', state: 'success' },
          { context: 'tests', state: 'failure' },
          { context: 'docs', state: 'pending' }
        ]
      })
    )
  } as const;

  return {
    github: {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql: {
        request: graphqlRequest
      },
      rest
    },
    repository: {
      owner: 'openai',
      repo: 'gated-review'
    },
    copilotReviewerLogin: 'github-copilot[bot]'
  } as ToolExecutionContext;
}

function getTool(name: string) {
  const tool = createToolRegistry(createMockContext()).find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }

  return tool;
}

async function expectSuccessfulToolOutput(
  name: string,
  input: unknown,
  schema: { parse(value: unknown): unknown },
  expected: unknown
) {
  const tool = getTool(name);
  const result = await tool.handler(input);

  expect(result).toEqual({ ok: true, value: expected });
  if (result.ok) {
    expect(schema.parse(result.value)).toEqual(expected);
  }
}

describe('tool shaped outputs', () => {
  it('keeps the registry output payloads shaped for read-model tools', async () => {
    await expectSuccessfulToolOutput(
      'get_review_round',
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      getReviewRoundOutputSchema,
      {
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
    );

    await expectSuccessfulToolOutput(
      'pr_status',
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      prStatusOutputSchema,
      {
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
    );
  });

  it('keeps mutation outputs shaped through the registry contract', async () => {
    await expectSuccessfulToolOutput(
      'open_pr',
      {
        repository: 'openai/gated-review',
        base: 'main',
        head: 'feature-branch',
        title: 'Add feature',
        body: 'Ship it',
        draft: true
      },
      openPrOutputSchema,
      {
        number: 17,
        url: 'https://github.com/openai/gated-review/pull/17',
        state: 'open'
      }
    );

    await expectSuccessfulToolOutput(
      'reply_to_thread',
      {
        repository: 'openai/gated-review',
        threadId: 'thread-1',
        body: 'Acknowledged'
      },
      replyToThreadOutputSchema,
      {
        ok: true
      }
    );

    await expectSuccessfulToolOutput(
      'resolve_thread',
      {
        repository: 'openai/gated-review',
        threadId: 'thread-1'
      },
      resolveThreadOutputSchema,
      {
        ok: true
      }
    );

    await expectSuccessfulToolOutput(
      'request_next_round',
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 17
      },
      requestNextRoundOutputSchema,
      {
        ok: true
      }
    );

    await expectSuccessfulToolOutput(
      'request_copilot_review',
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 17
      },
      requestCopilotReviewOutputSchema,
      {
        ok: true
      }
    );

    await expectSuccessfulToolOutput(
      'mark_merge_ready',
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 17,
        ready: true
      },
      markMergeReadyOutputSchema,
      {
        ok: true
      }
    );

    await expectSuccessfulToolOutput(
      'merge_pr',
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 17,
        mergeMethod: 'squash',
        commitTitle: 'Merge pull request #17',
        commitMessage: 'Gate satisfied',
        sha: 'head-sha-123'
      },
      mergePrOutputSchema,
      {
        merged: true,
        sha: 'merge-sha-123'
      }
    );
  });
});
