import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createRequestCopilotReviewHandler } from '#root/src/tools/operator/request-copilot-review.js';

describe('request_copilot_review', () => {
  it('requests the configured Copilot reviewer', async () => {
    const requestPullRequestReviewers = vi.fn(async () =>
      ok({
        number: 17,
        requested_reviewers: [{ login: 'github-copilot[bot]' }],
        requested_teams: []
      })
    );
    const context = {
      github: {
        graphql: {},
        rest: {
          requestPullRequestReviewers
        }
      },
      repository: {
        owner: 'openai',
        repo: 'gated-review'
      },
      copilotReviewerLogin: 'github-copilot[bot]'
    } as unknown as ToolExecutionContext;
    const handler = createRequestCopilotReviewHandler(context);

    const result = await handler({
      repository: 'openai/gated-review',
      pullRequestNumber: 17
    });

    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(requestPullRequestReviewers).toHaveBeenCalledWith(
      {
        owner: 'openai',
        repo: 'gated-review'
      },
      17,
      ['github-copilot[bot]']
    );
  });
});
