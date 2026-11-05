import { describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '#root/src/result.js';
import type { GitHubClient } from '#root/src/github/client.js';
import type { GitHubGraphQLRequest } from '#root/src/github/graphql.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import {
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery,
  type GraphQLPageInfo,
  type GraphQLReviewRoundThreadsQueryData,
  type GraphQLReviewRoundSummariesQueryData,
  type GraphQLReviewThreadCommentsQueryData
} from '#root/src/tools/read-model/graphql-queries.js';
import { createInMemoryFreshnessStore, makeRepoPrKey } from '#root/src/tools/freshness-store.js';
import { expectedTriagePrompt } from '#root/test/fixtures/review-triage-prompt.js';

function makeThreadsResponse(state: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN') {
  const pageInfo: GraphQLPageInfo = { hasNextPage: false, endCursor: null };
  return ok({
    repository: {
      pullRequest: {
        state,
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
          pageInfo
        }
      }
    }
  });
}

function createGitHubClientMock(prState: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN') {
  const request = vi.fn(async (
    requestInput: Pick<GitHubGraphQLRequest<unknown>, 'query' | 'variables'>
  ): Promise<Result<GraphQLReviewRoundThreadsQueryData | GraphQLReviewRoundSummariesQueryData | GraphQLReviewThreadCommentsQueryData, never>> => {
    if (requestInput.query === reviewRoundThreadsQuery) {
      return makeThreadsResponse(prState);
    }

    if (requestInput.query === reviewThreadCommentsQuery) {
      if (requestInput.variables?.id === 'thread-open' && requestInput.variables?.after === null) {
        return ok({
          node: {
            comments: {
              nodes: [
                {
                  id: 'comment-1',
                  body: 'first',
                  createdAt: '2026-06-02T12:00:00.000Z',
                  author: {
                    login: 'alice'
                  }
                }
              ],
              pageInfo: {
                hasNextPage: true,
                endCursor: 'open-comments-page-2'
              }
            }
          }
        });
      }

      if (requestInput.variables?.id === 'thread-open' && requestInput.variables?.after === 'open-comments-page-2') {
        return ok({
          node: {
            comments: {
              nodes: [
                {
                  id: 'comment-2',
                  body: 'second',
                  createdAt: '2026-06-02T12:01:00.000Z',
                  author: {
                    login: 'bob'
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

      if (requestInput.variables?.id === 'thread-resolved') {
        return ok({
          node: {
            comments: {
              nodes: [
                {
                  id: 'comment-3',
                  body: 'resolved thread note',
                  createdAt: '2026-06-02T12:02:00.000Z',
                  author: {
                    login: 'carol'
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
      if (requestInput.variables?.after === null) {
        return ok({
          repository: {
            pullRequest: {
              comments: {
                nodes: [
                  {
                    id: 'summary-1',
                    body: 'CodeRabbit summary',
                    createdAt: '2026-06-02T12:03:00.000Z',
                    author: {
                      login: 'coderabbitai[bot]'
                    }
                  },
                  {
                    id: 'summary-ignored',
                    body: 'human comment',
                    createdAt: '2026-06-02T12:03:30.000Z',
                    author: {
                      login: 'dave'
                    }
                  }
                ],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: 'summary-page-2'
                }
              }
            }
          }
        });
      }

      if (requestInput.variables?.after === 'summary-page-2') {
        return ok({
          repository: {
            pullRequest: {
              comments: {
                nodes: [
                  {
                    id: 'summary-2',
                    body: 'Copilot summary',
                    createdAt: '2026-06-02T12:04:00.000Z',
                    author: {
                      login: 'copilot[bot]'
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
    }

    throw new Error(`Unexpected query: ${requestInput.query}`);
  });

  const github = {
    graphql: {
      request
    }
  } as unknown as GitHubClient;

  return { github, request };
}

function createGitHubClientMockWithInvalidCommentTimestamp() {
  const request = vi.fn(async (requestInput: { query: string; variables?: Record<string, unknown> }) => {
    if (requestInput.query === reviewRoundThreadsQuery) {
      return makeThreadsResponse();
    }

    if (requestInput.query === reviewThreadCommentsQuery) {
      if (requestInput.variables?.id === 'thread-open') {
        return ok({
          node: {
            comments: {
              nodes: [
                {
                  id: 'comment-invalid',
                  body: 'invalid timestamp',
                  createdAt: 'not-a-date',
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
              nodes: [],
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            }
          }
        }
      });
    }

    throw new Error(`Unexpected query: ${requestInput.query}`);
  });

  const github = {
    graphql: {
      request
    }
  } as unknown as GitHubClient;

  return { github };
}

describe('getReviewRound', () => {
  it('returns unresolved threads by default with ordered comments and summary capture', async () => {
    const { github, request } = createGitHubClientMock();

    const result = await getReviewRound(
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 42
      },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]'
      }
    );

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalled();
    if (result.ok) {
      expect(result.value).toEqual({
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
                body: 'first',
                createdAt: '2026-06-02T12:00:00.000Z',
                author: {
                  login: 'alice',
                  kind: 'human'
                }
              },
              {
                id: 'comment-2',
                body: 'second',
                createdAt: '2026-06-02T12:01:00.000Z',
                author: {
                  login: 'bob',
                  kind: 'human'
                }
              }
            ]
          }
        ],
        summaries: [
          {
            id: 'summary-1',
            body: 'CodeRabbit summary',
            createdAt: '2026-06-02T12:03:00.000Z',
            author: {
              login: 'coderabbitai[bot]',
              kind: 'coderabbit'
            }
          },
          {
            id: 'summary-2',
            body: 'Copilot summary',
            createdAt: '2026-06-02T12:04:00.000Z',
            author: {
              login: 'copilot[bot]',
              kind: 'copilot'
            }
          }
        ]
      });
    }
  });

  it('includes resolved threads when requested', async () => {
    const { github } = createGitHubClientMock();

    const result = await getReviewRound(
      {
        repository: 'openai/gated-review',
        pullRequestNumber: 42,
        includeResolved: true
      },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]'
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads).toHaveLength(2);
      expect(result.value.threads[1]).toEqual({
        id: 'thread-resolved',
        state: 'resolved',
        path: 'src/resolved.ts',
        line: null,
        hasFreshComments: false,
        comments: [
          {
            id: 'comment-3',
            body: 'resolved thread note',
            createdAt: '2026-06-02T12:02:00.000Z',
            author: {
              login: 'carol',
              kind: 'human'
            }
          }
        ]
      });
    }
  });

  it('null prior delivers all unresolved thread comments on first fetch (restart self-heal)', async () => {
    const { github } = createGitHubClientMock();
    const freshness = createInMemoryFreshnessStore();

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]',
        freshness
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.freshSince).toBeNull();
      expect(result.value.threads[0].hasFreshComments).toBe(true);
    }
  });

  it.each([false, true])('keeps complete threads on repeated reads with includeResolved=%s', async (includeResolved) => {
    const { github } = createGitHubClientMock();
    const freshness = createInMemoryFreshnessStore();

    const context = {
      github,
      copilotReviewerLogin: 'github-copilot[bot]',
      freshness
    };

    const input = { repository: 'openai/gated-review', pullRequestNumber: 42, includeResolved };
    const first = await getReviewRound(input, context);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.freshSince).toBeNull();
      expect(first.value.threads[0].hasFreshComments).toBe(true);
    }

    const second = await getReviewRound(input, context);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.freshSince).toBe(includeResolved ? '2026-06-02T12:02:00.000Z' : '2026-06-02T12:01:00.000Z');
      expect(second.value.openThreadCount).toBe(1);
      expect(second.value.threads).toEqual(first.value.threads.map((thread) => ({
        ...thread,
        hasFreshComments: false
      })));
    }
  });

  it('keeps older comments as context when a thread has fresh comments', async () => {
    const { github } = createGitHubClientMock();
    const freshness = createInMemoryFreshnessStore();
    const prKey = makeRepoPrKey({ owner: 'openai', repo: 'gated-review' }, 42);
    freshness.record(prKey, '2026-06-02T12:00:00.000Z');

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]',
        freshness
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.freshSince).toBe('2026-06-02T12:00:00.000Z');
      expect(result.value.openThreadCount).toBe(1);
      expect(result.value.threads).toEqual([
        {
          id: 'thread-open',
          state: 'open',
          path: 'src/open.ts',
          line: 12,
          hasFreshComments: true,
          comments: [
            {
              id: 'comment-1',
              body: 'first',
              createdAt: '2026-06-02T12:00:00.000Z',
              author: {
                login: 'alice',
                kind: 'human'
              }
            },
            {
              id: 'comment-2',
              body: 'second',
              createdAt: '2026-06-02T12:01:00.000Z',
              author: {
                login: 'bob',
                kind: 'human'
              }
            }
          ]
        }
      ]);
    }
  });

  it('returns all comments when resolved threads are requested after an open-only read', async () => {
    const { github } = createGitHubClientMock();
    const context = {
      github,
      copilotReviewerLogin: 'github-copilot[bot]',
      freshness: createInMemoryFreshnessStore()
    };
    const input = { repository: 'openai/gated-review', pullRequestNumber: 42 };

    await getReviewRound(input, context);
    const result = await getReviewRound({ ...input, includeResolved: true }, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads.map((thread) => ({
        id: thread.id,
        commentIds: thread.comments.map((comment) => comment.id)
      }))).toEqual([
        { id: 'thread-open', commentIds: ['comment-1', 'comment-2'] },
        { id: 'thread-resolved', commentIds: ['comment-3'] }
      ]);
    }
  });

  it('returns threads even when another client has advanced the shared watermark past them', async () => {
    const { github } = createGitHubClientMock();
    const freshness = createInMemoryFreshnessStore();
    freshness.record(makeRepoPrKey({ owner: 'openai', repo: 'gated-review' }, 42), '2026-06-02T12:10:00.000Z');

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42, includeResolved: true },
      { github, copilotReviewerLogin: 'github-copilot[bot]', freshness }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads.map((thread) => ({
        id: thread.id,
        hasFreshComments: thread.hasFreshComments,
        commentIds: thread.comments.map((comment) => comment.id)
      }))).toEqual([
        { id: 'thread-open', hasFreshComments: false, commentIds: ['comment-1', 'comment-2'] },
        { id: 'thread-resolved', hasFreshComments: false, commentIds: ['comment-3'] }
      ]);
    }
  });

  it('keeps threads from every page on repeated reads', async () => {
    const { github, request } = createGitHubClientMock();
    const originalRequest = request.getMockImplementation();
    if (!originalRequest) throw new Error('Missing mock implementation');
    request.mockImplementation(async (input) => {
      if (input.query !== reviewRoundThreadsQuery) return originalRequest(input);

      const response = makeThreadsResponse();
      if (!response.ok) return response;
      const pullRequest = response.value.repository.pullRequest;
      const isFirstPage = input.variables?.after === null;
      return ok({
        repository: {
          pullRequest: {
            ...pullRequest,
            reviewThreads: {
              nodes: isFirstPage ? pullRequest.reviewThreads.nodes.slice(0, 1) : pullRequest.reviewThreads.nodes.slice(1),
              pageInfo: {
                hasNextPage: isFirstPage,
                endCursor: isFirstPage ? 'threads-page-2' : null
              }
            }
          }
        }
      });
    });
    const input = { repository: 'openai/gated-review', pullRequestNumber: 42, includeResolved: true };
    const context = {
      github,
      copilotReviewerLogin: 'github-copilot[bot]',
      freshness: createInMemoryFreshnessStore()
    };

    await getReviewRound(input, context);
    const result = await getReviewRound(input, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads.map((thread) => ({
        id: thread.id,
        commentIds: thread.comments.map((comment) => comment.id)
      }))).toEqual([
        { id: 'thread-open', commentIds: ['comment-1', 'comment-2'] },
        { id: 'thread-resolved', commentIds: ['comment-3'] }
      ]);
    }
  });

  it('keeps thread metadata when GitHub returns no comments', async () => {
    const { github, request } = createGitHubClientMock();
    const originalRequest = request.getMockImplementation();
    if (!originalRequest) throw new Error('Missing mock implementation');
    request.mockImplementation(async (input) => {
      if (input.query !== reviewThreadCommentsQuery) return originalRequest(input);
      return ok({
        node: {
          comments: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      });
    });

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      { github, copilotReviewerLogin: 'github-copilot[bot]', freshness: createInMemoryFreshnessStore() }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads).toEqual([{
        id: 'thread-open',
        state: 'open',
        path: 'src/open.ts',
        line: 12,
        hasFreshComments: false,
        comments: []
      }]);
    }
  });

  it('keeps every comment in a resolved thread when an author is missing', async () => {
    const { github, request } = createGitHubClientMock();
    const originalRequest = request.getMockImplementation();
    if (!originalRequest) throw new Error('Missing mock implementation');
    request.mockImplementation(async (input) => {
      if (input.query !== reviewThreadCommentsQuery || input.variables?.id !== 'thread-resolved') {
        return originalRequest(input);
      }
      return ok({
        node: {
          comments: {
            nodes: [
              { id: 'deleted-author-comment', body: 'feedback from a deleted account', createdAt: '2026-06-02T12:02:00.000Z', author: null },
              { id: 'reply', body: 'a reply', createdAt: '2026-06-02T12:03:00.000Z', author: { login: 'carol' } }
            ],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      });
    });

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42, includeResolved: true },
      { github, copilotReviewerLogin: 'github-copilot[bot]' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads.find((thread) => thread.id === 'thread-resolved')?.comments).toEqual([
        { id: 'deleted-author-comment', body: 'feedback from a deleted account', createdAt: '2026-06-02T12:02:00.000Z', author: null },
        { id: 'reply', body: 'a reply', createdAt: '2026-06-02T12:03:00.000Z', author: { login: 'carol', kind: 'human' } }
      ]);
    }
  });

  it('treats an invalid delivery watermark as absent when annotating freshness', async () => {
    const { github } = createGitHubClientMock();

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]',
        freshness: {
          lastDeliveredAt: () => 'not-a-date',
          record: () => undefined,
          purge: () => undefined
        }
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.freshSince).toBeNull();
      expect(result.value.threads).toHaveLength(1);
      expect(result.value.threads[0].hasFreshComments).toBe(true);
      expect(result.value.threads[0].comments).toHaveLength(2);
    }
  });

  it('treats invalid comment timestamps as fresh', async () => {
    const { github } = createGitHubClientMockWithInvalidCommentTimestamp();
    const freshness = createInMemoryFreshnessStore();
    const prKey = makeRepoPrKey({ owner: 'openai', repo: 'gated-review' }, 42);
    freshness.record(prKey, '2026-06-02T12:00:00.000Z');

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]',
        freshness
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.freshSince).toBe('2026-06-02T12:00:00.000Z');
      expect(result.value.threads).toHaveLength(1);
      expect(result.value.threads[0].hasFreshComments).toBe(true);
      expect(result.value.threads[0].comments).toEqual([
        {
          id: 'comment-invalid',
          body: 'invalid timestamp',
          createdAt: 'not-a-date',
          author: {
            login: 'alice',
            kind: 'human'
          }
        }
      ]);
      expect(freshness.lastDeliveredAt(prKey)).toBe('2026-06-02T12:00:00.000Z');
    }
  });

  it('purges the watermark when a MERGED PR state is observed', async () => {
    const { github } = createGitHubClientMock('MERGED');
    const freshness = createInMemoryFreshnessStore();

    const context = {
      github,
      copilotReviewerLogin: 'github-copilot[bot]',
      freshness
    };

    // First call with OPEN state to seed the watermark (reuse different client)
    const { github: openGithub } = createGitHubClientMock('OPEN');
    await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      { ...context, github: openGithub }
    );

    // Confirm watermark was recorded
    const prKey = makeRepoPrKey({ owner: 'openai', repo: 'gated-review' }, 42);
    expect(freshness.lastDeliveredAt(prKey)).not.toBeNull();

    // Now call with MERGED state — should purge
    await getReviewRound({ repository: 'openai/gated-review', pullRequestNumber: 42 }, context);
    expect(freshness.lastDeliveredAt(prKey)).toBeNull();
  });

  it('crash-after-fetch resurfaces unresolved thread comments via null prior', async () => {
    const { github } = createGitHubClientMock();
    const freshness = createInMemoryFreshnessStore();

    const result = await getReviewRound(
      { repository: 'openai/gated-review', pullRequestNumber: 42 },
      {
        github,
        copilotReviewerLogin: 'github-copilot[bot]',
        freshness
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.threads).toHaveLength(1);
      expect(result.value.threads[0].state).toBe('open');
    }
  });
});
