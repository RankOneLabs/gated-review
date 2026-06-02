import { z } from 'zod';

import { err, ok, type Result } from '#root/src/result.js';
import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import {
  markMergeReadyInputSchema,
  markMergeReadyOutputSchema
} from '#root/src/tools/schemas.js';

export type MarkMergeReadyInput = z.infer<typeof markMergeReadyInputSchema>;
export type MarkMergeReadyOutput = z.infer<typeof markMergeReadyOutputSchema>;

function mapGitHubError(error: { category: string; message: string; requestLabel: string; status?: number }) {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError('mark_merge_ready', `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

export function createMarkMergeReadyHandler(context: ToolExecutionContext) {
  return async function markMergeReady(
    input: unknown
  ): Promise<Result<MarkMergeReadyOutput, ToolDomainError>> {
    const parsedInput = markMergeReadyInputSchema.parse(input);
    const labelName = 'merge-ready';

    if (parsedInput.ready) {
      await context.github.rest.request<unknown>({
        operationName: 'mark_merge_ready',
        requestLabel: `GET /repos/${context.repository.owner}/${context.repository.repo}/labels/${labelName}`,
        method: 'GET',
        path: `/repos/${context.repository.owner}/${context.repository.repo}/labels/${labelName}`
      });

      const label = await context.github.rest.request<unknown>({
        operationName: 'mark_merge_ready',
        requestLabel: `POST /repos/${context.repository.owner}/${context.repository.repo}/issues/${parsedInput.pullRequestNumber}/labels`,
        method: 'POST',
        path: `/repos/${context.repository.owner}/${context.repository.repo}/issues/${parsedInput.pullRequestNumber}/labels`,
        body: {
          labels: [labelName]
        }
      });

      if (!label.ok) {
        return err(mapGitHubError(label.error));
      }
    } else {
      const label = await context.github.rest.request<unknown>({
        operationName: 'mark_merge_ready',
        requestLabel: `DELETE /repos/${context.repository.owner}/${context.repository.repo}/issues/${parsedInput.pullRequestNumber}/labels/${labelName}`,
        method: 'DELETE',
        path: `/repos/${context.repository.owner}/${context.repository.repo}/issues/${parsedInput.pullRequestNumber}/labels/${labelName}`
      });

      if (!label.ok) {
        return err(mapGitHubError(label.error));
      }
    }

    return ok({
      ok: true
    });
  };
}
