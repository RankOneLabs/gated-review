import { z } from 'zod';

import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { resolveReviewThread } from '#root/src/tools/mutations/graphql-mutations.js';

export const resolveThreadInputSchema = z
  .object({
    threadId: z.string().min(1)
  })
  .strict()
  .describe('resolve_thread.input');

export const resolveThreadOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('resolve_thread.output');

export type ResolveThreadInput = z.infer<typeof resolveThreadInputSchema>;
export type ResolveThreadOutput = z.infer<typeof resolveThreadOutputSchema>;

function mapGitHubError(operation: string, error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(operation, `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

export function createResolveThreadHandler(context: ToolExecutionContext) {
  return async function resolveThread(
    input: unknown
  ): Promise<Result<ResolveThreadOutput, ToolDomainError>> {
    const parsedInput = resolveThreadInputSchema.parse(input);
    const result = await resolveReviewThread(context.github.graphql, {
      threadId: parsedInput.threadId
    });

    if (!result.ok) {
      return err(mapGitHubError('resolve_thread', result.error));
    }

    return ok({
      ok: true
    });
  };
}
