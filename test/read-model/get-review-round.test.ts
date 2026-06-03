import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { GitHubClient } from '#root/src/github/client.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import {
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery
} from '#root/src/tools/read-model/graphql-queries.js';

function createGitHubClientMock() {
  const request = vi.fn(async (requestInput: { query: string; variables?: Record<string, unknown> }) => {
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
        pullRequestNumber: 42
      },
      {
        github,
        repository: {
          owner: 'openai',
          repo: 'gated-review'
        },
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
        threads: [
          {
            id: 'thread-open',
            state: 'open',
            path: 'src/open.ts',
            line: 12,
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
        pullRequestNumber: 42,
        includeResolved: true
      },
      {
        github,
        repository: {
          owner: 'openai',
          repo: 'gated-review'
        },
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
});
