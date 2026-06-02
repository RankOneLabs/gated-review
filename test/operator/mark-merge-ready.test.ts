import { describe, expect, it, vi } from 'vitest';

import { createGitHubError } from '#root/src/github/errors.js';
import { err, ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createMarkMergeReadyHandler } from '#root/src/tools/operator/mark-merge-ready.js';
import { prStatusLabelsQuery } from '#root/src/tools/read-model/graphql-queries.js';

describe('mark_merge_ready', () => {
  it('creates the merge-ready label when needed and adds it to the pull request', async () => {
    const request = vi.fn(async (input: { method: string; path: string }) => {
      if (input.method === 'GET' && input.path.endsWith('/labels/merge-ready')) {
        return err(
          createGitHubError({
            category: 'rest',
            operation: 'mark_merge_ready',
            requestLabel: 'GET /repos/openai/gated-review/labels/merge-ready',
            status: 404,
            message: 'Not Found'
          })
        );
      }

      if (input.method === 'POST' && input.path.endsWith('/labels')) {
        return ok({
          id: 1,
          name: 'merge-ready',
          color: 'c2e0c6'
        });
      }

      throw new Error(`Unexpected request: ${input.method} ${input.path}`);
    });
    const addIssueLabels = vi.fn(async () =>
      ok([
        {
          id: 1,
          name: 'merge-ready',
          color: 'c2e0c6'
        }
      ])
    );
    const context = {
      github: {
        graphql: {
          request: vi.fn(async () =>
            ok({
              repository: {
                pullRequest: {
                  labels: {
                    nodes: [],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            })
          )
        },
        rest: {
          request,
          addIssueLabels
        }
      },
      repository: {
        owner: 'openai',
        repo: 'gated-review'
      }
    } as unknown as ToolExecutionContext;
    const handler = createMarkMergeReadyHandler(context);

    const result = await handler({
      pullRequestNumber: 17,
      ready: true
    });

    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/repos/openai/gated-review/labels/merge-ready'
      })
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/repos/openai/gated-review/labels'
      })
    );
    expect(addIssueLabels).toHaveBeenCalledWith(
      {
        owner: 'openai',
        repo: 'gated-review'
      },
      17,
      ['merge-ready']
    );
  });

  it('removes the merge-ready label when ready is false', async () => {
    const request = vi.fn(async (input: { method: string; path: string }) => {
      if (input.method === 'DELETE') {
        return ok(undefined);
      }

      throw new Error(`Unexpected request: ${input.method} ${input.path}`);
    });
    const addIssueLabels = vi.fn(async () => ok([]));
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
          request,
          addIssueLabels
        }
      },
      repository: {
        owner: 'openai',
        repo: 'gated-review'
      }
    } as unknown as ToolExecutionContext;
    const handler = createMarkMergeReadyHandler(context);

    const result = await handler({
      pullRequestNumber: 17,
      ready: false
    });

    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: '/repos/openai/gated-review/issues/17/labels/merge-ready'
      })
    );
    expect(addIssueLabels).not.toHaveBeenCalled();
  });
});
