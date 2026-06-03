import { err, ok, type Result } from '#root/src/result.js';
import { githubError, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { requestCopilotReviewInputSchema } from '#root/src/tools/schemas.js';
import type { RequestCopilotReviewOutput } from '#root/src/tools/types.js';

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
    const parsed = requestCopilotReviewInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(validationRejectedError('request_copilot_review', parsed.error.message));
    }

    const parsedInput = parsed.data;
    const result = await context.github.rest.requestPullRequestReviewers(
      context.repository,
      parsedInput.pullRequestNumber,
      [context.copilotReviewerLogin]
    );

    if (!result.ok) {
      return err(mapGitHubError(result.error));
    }

    return ok({
      ok: true
    });
  };
}
