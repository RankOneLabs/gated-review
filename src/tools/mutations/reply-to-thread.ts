import { z } from 'zod';

import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { mapGitHubError } from '#root/src/tools/mutations/errors.js';
import {
  addPullRequestReviewThreadReply,
  type AddPullRequestReviewThreadReplyInput
} from '#root/src/tools/mutations/graphql-mutations.js';

export const replyToThreadInputSchema = z
  .object({
    threadId: z.string().min(1),
    body: z.string().min(1)
  })
  .strict()
  .describe('reply_to_thread.input');

export const replyToThreadOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('reply_to_thread.output');

export type ReplyToThreadInput = z.infer<typeof replyToThreadInputSchema>;
export type ReplyToThreadOutput = z.infer<typeof replyToThreadOutputSchema>;

export function createReplyToThreadHandler(context: ToolExecutionContext) {
  return async function replyToThread(
    input: unknown
  ): Promise<Result<ReplyToThreadOutput, ToolDomainError>> {
    const parsed = replyToThreadInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(validationRejectedError('reply_to_thread', parsed.error.message));
    }

    const parsedInput = parsed.data;
    const result = await addPullRequestReviewThreadReply(context.github.graphql, {
      threadId: parsedInput.threadId,
      body: parsedInput.body
    } satisfies AddPullRequestReviewThreadReplyInput);

    if (!result.ok) {
      return err(mapGitHubError('reply_to_thread', result.error));
    }

    return ok({
      ok: true
    });
  };
}
