import { z } from 'zod';

import { err, ok, type Result } from '#root/src/result.js';
import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import {
  requestCopilotReviewInputSchema,
  requestCopilotReviewOutputSchema
} from '#root/src/tools/schemas.js';

export type RequestCopilotReviewInput = z.infer<typeof requestCopilotReviewInputSchema>;
export type RequestCopilotReviewOutput = z.infer<typeof requestCopilotReviewOutputSchema>;

function mapGitHubError(error: { category: string; message: string; requestLabel: string; status?: number }) {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(
    'request_copilot_review',
    `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`
  );
}

export function createRequestCopilotReviewHandler(context: ToolExecutionContext) {
  return async function requestCopilotReview(
    input: unknown
  ): Promise<Result<RequestCopilotReviewOutput, ToolDomainError>> {
    const parsedInput = requestCopilotReviewInputSchema.parse(input);
    const reviewerLogin = process.env.GITHUB_COPILOT_REVIEWER_LOGIN ?? 'copilot[bot]';

    const result = await context.github.rest.request<unknown>({
      operationName: 'request_copilot_review',
      requestLabel: `POST /repos/${context.repository.owner}/${context.repository.repo}/pulls/${parsedInput.pullRequestNumber}/requested_reviewers`,
      method: 'POST',
      path: `/repos/${context.repository.owner}/${context.repository.repo}/pulls/${parsedInput.pullRequestNumber}/requested_reviewers`,
      body: {
        reviewers: [reviewerLogin]
      }
    });

    if (!result.ok) {
      return err(mapGitHubError(result.error));
    }

    return ok({
      ok: true
    });
  };
}
