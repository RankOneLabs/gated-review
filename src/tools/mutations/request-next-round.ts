import { z } from 'zod';

import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { mapGitHubError } from '#root/src/tools/mutations/errors.js';

export const requestNextRoundInputSchema = z
  .object({
    pullRequestNumber: z.number().int().positive()
  })
  .strict()
  .describe('request_next_round.input');

export const requestNextRoundOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('request_next_round.output');

export type RequestNextRoundInput = z.infer<typeof requestNextRoundInputSchema>;
export type RequestNextRoundOutput = z.infer<typeof requestNextRoundOutputSchema>;

export function createRequestNextRoundHandler(context: ToolExecutionContext) {
  return async function requestNextRound(
    input: unknown
  ): Promise<Result<RequestNextRoundOutput, ToolDomainError>> {
    const parsed = requestNextRoundInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(validationRejectedError('request_next_round', parsed.error.message));
    }

    const parsedInput = parsed.data;
    const result = await context.github.rest.createIssueComment(
      context.repository,
      parsedInput.pullRequestNumber,
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
