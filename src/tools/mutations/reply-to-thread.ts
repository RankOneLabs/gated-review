import { z } from 'zod';

import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
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
  .describe('github.reply_to_thread.input');

export const replyToThreadOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('github.reply_to_thread.output');

export type ReplyToThreadInput = z.infer<typeof replyToThreadInputSchema>;
export type ReplyToThreadOutput = z.infer<typeof replyToThreadOutputSchema>;

function mapGitHubError(operation: string, error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(operation, `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

export function createReplyToThreadHandler(context: ToolExecutionContext) {
  return async function replyToThread(
    input: ReplyToThreadInput
  ): Promise<Result<ReplyToThreadOutput, ToolDomainError>> {
    const result = await addPullRequestReviewThreadReply(context.github.graphql, {
      threadId: input.threadId,
      body: input.body
    } satisfies AddPullRequestReviewThreadReplyInput);

    if (!result.ok) {
      return err(mapGitHubError('reply_to_thread', result.error));
    }

    return ok({
      ok: true
    });
  };
}
