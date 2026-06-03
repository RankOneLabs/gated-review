import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import {
  prStatusLabelsQuery,
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery
} from '#root/src/tools/read-model/graphql-queries.js';

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

        if (request.operationName === 'AddPullRequestReviewThreadReply') {
          return jsonResponse({
            data: {
              addPullRequestReviewThreadReply: {
                comment: {
                  id: 'comment-123'
                }
              }
            }
          });
        }

        if (request.operationName === 'ResolveReviewThread') {
          return jsonResponse({
            data: {
              resolveReviewThread: {
                thread: {
                  id: 'thread-123'
                }
              }
            }
          });
        }

        if (request.query === reviewRoundThreadsQuery) {
          return jsonResponse({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [],
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

        if (request.query === reviewRoundSummariesQuery) {
          return jsonResponse({
            data: {
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

        if (url.endsWith('/pulls')) {
          return jsonResponse({
            number: 17,
            html_url: 'https://github.com/openai/gated-review/pull/17',
            state: 'open'
          }, 201);
        }

        if (url.endsWith('/issues/17/comments')) {
          return jsonResponse({
            id: 123,
            body: '@coderabbitai review',
            html_url: 'https://github.com/openai/gated-review/pull/17#issuecomment-123'
          }, 201);
        }

        if (url.endsWith('/pulls/17/requested_reviewers')) {
          return jsonResponse({
            number: 17,
            requested_reviewers: [{ login: 'github-copilot[bot]' }],
            requested_teams: []
          }, 201);
        }

        if (url.endsWith('/labels/merge-ready') && init?.method === 'GET') {
          return jsonResponse({ message: 'Not Found' }, 404);
        }

        if (url.endsWith('/labels') && init?.method === 'POST') {
          return jsonResponse({
            id: 1,
            name: 'merge-ready',
            color: 'c2e0c6'
          }, 201);
        }

        if (url.endsWith('/issues/17/labels/merge-ready') && init?.method === 'DELETE') {
          return new Response(null, {
            status: 204
          });
        }

        if (url.endsWith('/issues/17/labels') && init?.method === 'POST') {
          return jsonResponse([
            {
              id: 1,
              name: 'merge-ready',
              color: 'c2e0c6'
            }
          ]);
        }

        if (url.endsWith('/pulls/17/merge')) {
          return jsonResponse({
            merged: true,
            sha: 'merge-sha-123',
            message: 'Merged'
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
      repository: {
        owner: 'openai',
        repo: 'gated-review'
      },
      copilotReviewerLogin: 'github-copilot[bot]'
    } satisfies ToolExecutionContext
  };
}

describe('mutation integration', () => {
  it('routes the mutation tools through mocked GitHub clients', async () => {
    const { context, requests } = createMockContext();
    const tools = createToolRegistry(context);
    const tool = (name: string) => {
      const found = tools.find((entry) => entry.name === name);
      expect(found).toBeDefined();
      if (!found) {
        throw new Error(`Missing tool ${name}`);
      }

      return found;
    };

    await expect(tool('open_pr').handler({
      base: 'main',
      head: 'feature-branch',
      title: 'Add feature',
      body: 'Ship it',
      draft: true
    })).resolves.toEqual({
      ok: true,
      value: {
        number: 17,
        url: 'https://github.com/openai/gated-review/pull/17',
        state: 'open'
      }
    });

    await expect(tool('reply_to_thread').handler({
      threadId: 'thread-123',
      body: 'Acknowledged'
    })).resolves.toEqual({
      ok: true,
      value: {
        ok: true
      }
    });

    await expect(tool('resolve_thread').handler({
      threadId: 'thread-123'
    })).resolves.toEqual({
      ok: true,
      value: {
        ok: true
      }
    });

    await expect(tool('request_next_round').handler({
      pullRequestNumber: 17
    })).resolves.toEqual({
      ok: true,
      value: {
        ok: true
      }
    });

    await expect(tool('request_copilot_review').handler({
      pullRequestNumber: 17
    })).resolves.toEqual({
      ok: true,
      value: {
        ok: true
      }
    });

    await expect(tool('mark_merge_ready').handler({
      pullRequestNumber: 17,
      ready: true
    })).resolves.toEqual({
      ok: true,
      value: {
        ok: true
      }
    });

    await expect(tool('merge_pr').handler({
      pullRequestNumber: 17,
      mergeMethod: 'squash',
      commitTitle: 'Merge pull request #17',
      commitMessage: 'Gate satisfied',
      sha: 'head-sha-123'
    })).resolves.toEqual({
      ok: true,
      value: {
        merged: true,
        sha: 'merge-sha-123'
      }
    });

    expect(
      requests
        .filter((entry) => entry.kind === 'rest')
        .map((entry) => (entry.request as { url: string; method: string; body?: unknown }).url)
    ).toEqual([
      'https://api.github.com/repos/openai/gated-review/pulls',
      'https://api.github.com/repos/openai/gated-review/issues/17/comments',
      'https://api.github.com/repos/openai/gated-review/pulls/17/requested_reviewers',
      'https://api.github.com/repos/openai/gated-review/labels/merge-ready',
      'https://api.github.com/repos/openai/gated-review/labels',
      'https://api.github.com/repos/openai/gated-review/issues/17/labels',
      'https://api.github.com/repos/openai/gated-review/pulls/17/merge'
    ]);
  });
});
