import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createMergePrHandler } from '#root/src/tools/operator/merge-pr.js';
import { prStatusLabelsQuery } from '#root/src/tools/read-model/graphql-queries.js';

describe('merge_pr', () => {
  it('merges only after the merge-ready label is present', async () => {
    const mergePullRequest = vi.fn(async () =>
      ok({
        merged: true,
        sha: 'merge-sha-123',
        message: 'Merged'
      })
    );
    const context = {
      github: {
        graphql: {
          request: vi.fn(async (input: { query: string }) => {
            if (input.query === prStatusLabelsQuery) {
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

            throw new Error(`Unexpected graphql query: ${input.query}`);
          })
        },
        rest: {
          mergePullRequest
        }
      },
      repository: {
        owner: 'openai',
        repo: 'gated-review'
      }
    } as unknown as ToolExecutionContext;
    const handler = createMergePrHandler(context);

    const result = await handler({
      pullRequestNumber: 17,
      mergeMethod: 'squash',
      commitTitle: 'Merge pull request #17',
      commitMessage: 'Gate satisfied',
      sha: 'head-sha-123'
    });

    expect(result).toEqual({ ok: true, value: { merged: true, sha: 'merge-sha-123' } });
    expect(mergePullRequest).toHaveBeenCalledWith(
      {
        owner: 'openai',
        repo: 'gated-review'
      },
      17,
      {
        mergeMethod: 'squash',
        commitTitle: 'Merge pull request #17',
        commitMessage: 'Gate satisfied',
        sha: 'head-sha-123'
      }
    );
  });

  it('refuses to merge when merge-ready is absent', async () => {
    const mergePullRequest = vi.fn(async () =>
      ok({
        merged: true,
        sha: 'merge-sha-123',
        message: 'Merged'
      })
    );
    const context = {
      github: {
        graphql: {
          request: vi.fn(async (input: { query: string }) => {
            if (input.query === prStatusLabelsQuery) {
              return ok({
                repository: {
                  pullRequest: {
                    labels: {
                      nodes: [{ name: 'documentation' }],
                      pageInfo: {
                        hasNextPage: false,
                        endCursor: null
                      }
                    }
                  }
                }
              });
            }

            throw new Error(`Unexpected graphql query: ${input.query}`);
          })
        },
        rest: {
          mergePullRequest
        }
      },
      repository: {
        owner: 'openai',
        repo: 'gated-review'
      }
    } as unknown as ToolExecutionContext;
    const handler = createMergePrHandler(context);

    const result = await handler({
      pullRequestNumber: 17,
      mergeMethod: 'merge'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_rejected');
      expect(result.error.detail).toContain('merge-ready');
    }
    expect(mergePullRequest).not.toHaveBeenCalled();
  });
});
