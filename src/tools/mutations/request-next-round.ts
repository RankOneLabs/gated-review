import { z } from 'zod';

import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';

export const requestNextRoundInputSchema = z
  .object({
    pullRequestNumber: z.number().int().positive()
  })
  .strict()
  .describe('github.request_next_round.input');

export const requestNextRoundOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('github.request_next_round.output');

export type RequestNextRoundInput = z.infer<typeof requestNextRoundInputSchema>;
export type RequestNextRoundOutput = z.infer<typeof requestNextRoundOutputSchema>;

function mapGitHubError(operation: string, error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(operation, `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

export function createRequestNextRoundHandler(context: ToolExecutionContext) {
  return async function requestNextRound(
    input: RequestNextRoundInput
  ): Promise<Result<RequestNextRoundOutput, ToolDomainError>> {
    const result = await context.github.rest.createIssueComment(
      context.repository,
      input.pullRequestNumber,
      '@coderabbitai review'
    );

    if (!result.ok) {
      return err(mapGitHubError('request_next_round', result.error));
    }

    return ok({
      ok: true
    });
  };
}
