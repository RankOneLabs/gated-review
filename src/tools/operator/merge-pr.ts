import { z } from 'zod';

import { err, ok, type Result } from '#root/src/result.js';
import { validationRejectedError, githubError, toolEntity, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import {
  mergePrInputSchema,
  mergePrOutputSchema
} from '#root/src/tools/schemas.js';
import { loadMergeReadyState } from '#root/src/tools/operator/merge-ready.js';

export type MergePrInput = z.infer<typeof mergePrInputSchema>;
export type MergePrOutput = z.infer<typeof mergePrOutputSchema>;

function mapGitHubError(error: { category: string; message: string; requestLabel: string; status?: number }) {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError('merge_pr', `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

function remapToolError(error: ToolDomainError): ToolDomainError {
  return {
    ...error,
    operation: 'merge_pr',
    entity: toolEntity('merge_pr')
  };
}

export function createMergePrHandler(context: ToolExecutionContext) {
  return async function mergePr(input: unknown): Promise<Result<MergePrOutput, ToolDomainError>> {
    const parsedInput = mergePrInputSchema.parse(input);
    const mergeReady = await loadMergeReadyState(context, parsedInput.pullRequestNumber);
    if (!mergeReady.ok) {
      return err(remapToolError(mergeReady.error));
    }

    if (!mergeReady.value) {
      return err(
        validationRejectedError(
          'merge_pr',
          `Pull request #${parsedInput.pullRequestNumber} must have the merge-ready label before merging.`
        )
      );
    }

    const result = await context.github.rest.mergePullRequest(context.repository, parsedInput.pullRequestNumber, {
      mergeMethod: parsedInput.mergeMethod,
      commitTitle: parsedInput.commitTitle,
      commitMessage: parsedInput.commitMessage,
      sha: parsedInput.sha
    });

    if (!result.ok) {
      return err(mapGitHubError(result.error));
    }

    return ok({
      merged: result.value.merged,
      sha: result.value.sha
    });
  };
}
