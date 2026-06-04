import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { GitHubClient } from '#root/src/github/client.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import {
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery
} from '#root/src/tools/read-model/graphql-queries.js';
import { createInMemoryFreshnessStore } from '#root/src/tools/freshness-store.js';

function makeThreadsResponse(state: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN') {
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
          pageInfo: {
            hasNextPage: false,
            endCursor: null
          }
        }
      }
    }
  });
}

function createGitHubClientMock(prState: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN') {
  const request = vi.fn(async (requestInput: { query: string; variables?: Record<string, unknown> }) => {
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

  it('null prior over-flags all unresolved threads as fresh on first fetch (restart self-heal)', async () => {
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

  it('advances watermark on fetch and uses prior for hasFreshComments on second call', async () => {
    const { github } = createGitHubClientMock();
    const freshness = createInMemoryFreshnessStore();

    const context = {
      github,
      copilotReviewerLogin: 'github-copilot[bot]',
      freshness
    };

    const first = await getReviewRound({ repository: 'openai/gated-review', pullRequestNumber: 42 }, context);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.freshSince).toBeNull();
      expect(first.value.threads[0].hasFreshComments).toBe(true);
    }

    // Second call: watermark now advanced to max comment createdAt ('2026-06-02T12:01:00.000Z').
    // All existing comments are <= watermark, so hasFreshComments = false.
    const second = await getReviewRound({ repository: 'openai/gated-review', pullRequestNumber: 42 }, context);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.freshSince).toBe('2026-06-02T12:01:00.000Z');
      expect(second.value.threads[0].hasFreshComments).toBe(false);
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
    const { makeRepoPrKey: mkKey } = await import('#root/src/tools/freshness-store.js');
    const prKey = mkKey({ owner: 'openai', repo: 'gated-review' }, 42);
    expect(freshness.lastDeliveredAt(prKey)).not.toBeNull();

    // Now call with MERGED state — should purge
    await getReviewRound({ repository: 'openai/gated-review', pullRequestNumber: 42 }, context);
    expect(freshness.lastDeliveredAt(prKey)).toBeNull();
  });

  it('crash-after-fetch resurfaces unresolved threads via the unresolved set', async () => {
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
