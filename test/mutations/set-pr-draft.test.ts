import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createSetPrDraftHandler } from '#root/src/tools/mutations/set-pr-draft.js';

type GraphQLRequest = { operationName: string; variables?: Record<string, unknown> };

const pullRequestUrl = 'https://github.com/openai/gated-review/pull/42';

function createContext(currentIsDraft: boolean | null) {
  const request = vi.fn(async (input: GraphQLRequest) => {
    if (input.operationName === 'PullRequestDraftState') {
      return ok({
        repository: {
          pullRequest:
            currentIsDraft === null
              ? null
              : { id: 'PR_node_42', number: 42, url: pullRequestUrl, isDraft: currentIsDraft }
        }
      });
    }
    if (input.operationName === 'MarkPullRequestReadyForReview') {
      return ok({ markPullRequestReadyForReview: { pullRequest: { number: 42, url: pullRequestUrl, isDraft: false } } });
    }
    if (input.operationName === 'ConvertPullRequestToDraft') {
      return ok({ convertPullRequestToDraft: { pullRequest: { number: 42, url: pullRequestUrl, isDraft: true } } });
    }
    throw new Error(`Unexpected GraphQL operation: ${input.operationName}`);
  });

  const context = {
    github: {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql: { request },
      rest: {}
    },
    copilotReviewerLogin: 'github-copilot[bot]'
  } as unknown as ToolExecutionContext;

  return { context, request };
}

function operationNames(request: ReturnType<typeof createContext>['request']) {
  return request.mock.calls.map(([input]) => input.operationName);
}

describe('set_pr_draft', () => {
  it('marks a draft pull request ready for review by its node id', async () => {
    const { context, request } = createContext(true);

    const result = await createSetPrDraftHandler(context)({
      repository: 'openai/gated-review',
      pullRequestNumber: 42,
      draft: false
    });

    expect(result).toEqual({ ok: true, value: { number: 42, url: pullRequestUrl, isDraft: false } });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      operationName: 'MarkPullRequestReadyForReview',
      variables: { pullRequestId: 'PR_node_42' }
    });
  });

  it('converts a ready pull request to a draft', async () => {
    const { context, request } = createContext(false);

    const result = await createSetPrDraftHandler(context)({
      repository: 'openai/gated-review',
      pullRequestNumber: 42,
      draft: true
    });

    expect(result).toEqual({ ok: true, value: { number: 42, url: pullRequestUrl, isDraft: true } });
    expect(operationNames(request)).toEqual(['PullRequestDraftState', 'ConvertPullRequestToDraft']);
  });

  it('logs a change of draft state, and nothing when the state already matches', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await createSetPrDraftHandler(createContext(true).context)({
        repository: 'openai/gated-review',
        pullRequestNumber: 42,
        draft: false
      });
      await createSetPrDraftHandler(createContext(false).context)({
        repository: 'openai/gated-review',
        pullRequestNumber: 42,
        draft: false
      });

      expect(info.mock.calls.filter(([message]) => message === '[gated-review] pr draft changed')).toEqual([
        [
          '[gated-review] pr draft changed',
          { repository: 'openai/gated-review', pullRequestNumber: 42, from: 'draft', to: 'ready' }
        ]
      ]);
    } finally {
      info.mockRestore();
    }
  });

  it('makes no mutation when the pull request is already in the requested state', async () => {
    const { context, request } = createContext(false);

    const result = await createSetPrDraftHandler(context)({
      repository: 'openai/gated-review',
      pullRequestNumber: 42,
      draft: false
    });

    expect(result).toEqual({ ok: true, value: { number: 42, url: pullRequestUrl, isDraft: false } });
    expect(operationNames(request)).toEqual(['PullRequestDraftState']);
  });

  it('reports a missing pull request as a request failure', async () => {
    const { context } = createContext(null);

    const result = await createSetPrDraftHandler(context)({
      repository: 'openai/gated-review',
      pullRequestNumber: 42,
      draft: false
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('github_request_failed');
      expect(result.error.operation).toBe('set_pr_draft');
    }
  });
});
