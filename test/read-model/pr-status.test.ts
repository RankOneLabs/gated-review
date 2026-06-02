import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { GitHubClient } from '#root/src/github/client.js';
import { getPrStatus } from '#root/src/tools/read-model/pr-status.js';
import { prStatusQuery } from '#root/src/tools/read-model/graphql-queries.js';

function createGitHubClientMock() {
  let callIndex = 0;
  const request = vi.fn(async (requestInput: { query: string; variables?: Record<string, unknown> }) => {
    if (requestInput.query !== prStatusQuery) {
      throw new Error(`Unexpected query: ${requestInput.query}`);
    }

    callIndex += 1;

    if (callIndex === 1) {
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
                hasNextPage: true,
                endCursor: 'threads-page-2'
              }
            },
            labels: {
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

    if (callIndex === 2) {
      return ok({
        repository: {
          pullRequest: {
            headRefOid: 'head-sha-123',
            reviewThreads: {
              nodes: [{ isResolved: false }],
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            },
            labels: {
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

    if (callIndex === 3) {
      return ok({
        repository: {
          pullRequest: {
            headRefOid: 'head-sha-123',
            reviewThreads: {
              nodes: [],
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            },
            labels: {
              nodes: [{ name: 'documentation' }],
              pageInfo: {
                hasNextPage: true,
                endCursor: 'labels-page-2'
              }
            }
          }
        }
      });
    }

    if (callIndex === 4) {
      return ok({
        repository: {
          pullRequest: {
            headRefOid: 'head-sha-123',
            reviewThreads: {
              nodes: [],
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            },
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

    throw new Error('Unexpected pr status request');
  });

  const rest = {
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
  } as unknown as GitHubClient['rest'];

  const github = {
    graphql: {
      request
    },
    rest
  } as unknown as GitHubClient;

  return { github, request, rest };
}

describe('getPrStatus', () => {
  it('reads open-thread counts, merge-ready labels, and check state from GitHub', async () => {
    const { github, request, rest } = createGitHubClientMock();

    const result = await getPrStatus(
      {
        pullRequestNumber: 42
      },
      {
        github,
        repository: {
          owner: 'openai',
          repo: 'gated-review'
        }
      }
    );

    expect(request).toHaveBeenCalledTimes(4);
    expect(rest.getCommitCombinedStatus).toHaveBeenCalledWith(
      {
        owner: 'openai',
        repo: 'gated-review'
      },
      'head-sha-123'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        pullRequestNumber: 42,
        openThreadCount: 2,
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
      });
    }
  });
});
