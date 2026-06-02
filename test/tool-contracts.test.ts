import { describe, expect, it } from 'vitest';

import type { ReviewId } from '#root/src/domain.js';
import { ok } from '#root/src/result.js';
import { actorScopes } from '#root/src/tools/actors.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import {
  reviewActionSchema,
  reviewDecisionInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema
} from '#root/src/tools/schemas.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import type { ToolContract } from '#root/src/tools/types.js';
import type { ZodTypeAny } from 'zod';

function createMockContext() {
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

        return new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    }
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
    repository: { owner: 'openai', repo: 'gated-review' }
  };
}

async function runStubHandler(tool: ToolContract<ZodTypeAny, ZodTypeAny, string>) {
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
                : {
                    reviewId: 'review-123'
                  }
  );

  return {
    tool,
    result: await tool.handler(input)
  };
}

describe('tool contracts', () => {
  it('exposes a narrow curated tool surface', () => {
    expect(createToolRegistry(createMockContext()).map((tool) => tool.name)).toEqual([
      'review.get_state',
      'review.list_actions',
      'review.record_event',
      'review.apply_decision',
      'open_pr',
      'reply_to_thread',
      'resolve_thread',
      'request_next_round',
      'git.push',
      'git.pull',
      'git.fetch'
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
      'git.push.output',
      'git.pull.output',
      'git.fetch.output'
    ]);
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

  it('returns result values with domain errors for the review stub handlers', async () => {
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
      } else {
        expect(result).toEqual({ ok: true, value: { ok: true } });
      }
    }
  });
});
