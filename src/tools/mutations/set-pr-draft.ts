import { z } from 'zod';

import { githubRequestFailedError, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { mapGitHubError } from '#root/src/tools/mutations/errors.js';
import {
  convertPullRequestToDraft,
  fetchPullRequestDraftState,
  markPullRequestReadyForReview
} from '#root/src/tools/mutations/graphql-mutations.js';
import { parseRepoSlug, repositorySlugSchema } from '#root/src/tools/repository-ref.js';

const operationName = 'set_pr_draft';

export const setPrDraftInputSchema = z
  .object({
    repository: repositorySlugSchema,
    pullRequestNumber: z.number().int().positive(),
    draft: z.boolean()
  })
  .strict()
  .describe('set_pr_draft.input');

export const setPrDraftOutputSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.string().url(),
    isDraft: z.boolean()
  })
  .strict()
  .describe('set_pr_draft.output');

export type SetPrDraftInput = z.infer<typeof setPrDraftInputSchema>;
export type SetPrDraftOutput = z.infer<typeof setPrDraftOutputSchema>;

export function createSetPrDraftHandler(context: ToolExecutionContext) {
  return async function setPrDraft(input: unknown): Promise<Result<SetPrDraftOutput, ToolDomainError>> {
    const parsed = setPrDraftInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(validationRejectedError(operationName, parsed.error.message));
    }

    const parsedInput = parsed.data;
    const repoRef = parseRepoSlug(parsedInput.repository);
    if (!repoRef.ok) {
      return err(validationRejectedError(operationName, repoRef.error.detail));
    }

    const current = await fetchPullRequestDraftState(context.github.graphql, {
      owner: repoRef.value.owner,
      repo: repoRef.value.repo,
      number: parsedInput.pullRequestNumber
    });
    if (!current.ok) {
      return err(mapGitHubError(operationName, current.error));
    }

    const pullRequest = current.value.repository?.pullRequest;
    if (!pullRequest) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${parsedInput.pullRequestNumber} was not found.`)
      );
    }

    // Already in the requested state: report it without a mutation, so a retry is harmless.
    if (pullRequest.isDraft === parsedInput.draft) {
      return ok({ number: pullRequest.number, url: pullRequest.url, isDraft: pullRequest.isDraft });
    }

    const mutationInput = {
      pullRequestId: pullRequest.id,
      repository: { owner: repoRef.value.owner, repo: repoRef.value.repo }
    };

    const changed = parsedInput.draft
      ? await convertPullRequestToDraft(context.github.graphql, mutationInput)
      : await markPullRequestReadyForReview(context.github.graphql, mutationInput);
    if (!changed.ok) {
      return err(mapGitHubError(operationName, changed.error));
    }
    const updated = 'convertPullRequestToDraft' in changed.value
      ? changed.value.convertPullRequestToDraft.pullRequest
      : changed.value.markPullRequestReadyForReview.pullRequest;
    console.info('[gated-review] pr draft changed', {
      repository: parsedInput.repository,
      pullRequestNumber: pullRequest.number,
      from: pullRequest.isDraft ? 'draft' : 'ready',
      to: updated.isDraft ? 'draft' : 'ready'
    });
    return ok({ number: updated.number, url: updated.url, isDraft: updated.isDraft });
  };
}
