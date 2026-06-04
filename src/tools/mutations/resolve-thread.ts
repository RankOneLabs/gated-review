import { z } from 'zod';

import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { mapGitHubError } from '#root/src/tools/mutations/errors.js';
import { resolveReviewThread } from '#root/src/tools/mutations/graphql-mutations.js';
import { enforceThreadRepository } from '#root/src/tools/mutations/thread-scope.js';
import { parseRepoSlug } from '#root/src/tools/repository-ref.js';

export const resolveThreadInputSchema = z
  .object({
    repository: z.string().min(1),
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

export function createResolveThreadHandler(context: ToolExecutionContext) {
  return async function resolveThread(
    input: unknown
  ): Promise<Result<ResolveThreadOutput, ToolDomainError>> {
    const parsed = resolveThreadInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(validationRejectedError('resolve_thread', parsed.error.message));
    }

    const parsedInput = parsed.data;
    const repoRef = parseRepoSlug(parsedInput.repository);
    if (!repoRef.ok) {
      return err(validationRejectedError('resolve_thread', repoRef.error.detail));
    }

    const scope = await enforceThreadRepository(
      context.github.graphql,
      'resolve_thread',
      parsedInput.threadId,
      repoRef.value
    );
    if (!scope.ok) {
      return err(scope.error);
    }

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
