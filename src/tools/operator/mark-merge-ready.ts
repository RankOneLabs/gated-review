import { err, ok, type Result } from '#root/src/result.js';
import { githubError, toolEntity, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import {
  markMergeReadyInputSchema,
  markMergeReadyOutputSchema
} from '#root/src/tools/schemas.js';
import {
  addMergeReadyLabel,
  loadMergeReadyState,
  removeMergeReadyLabel
} from '#root/src/tools/operator/merge-ready.js';
import type { MarkMergeReadyOutput } from '#root/src/tools/types.js';

function mapGitHubError(error: { category: string; message: string; requestLabel: string; status?: number }) {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError('mark_merge_ready', `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

function remapToolError(error: ToolDomainError): ToolDomainError {
  return {
    ...error,
    operation: 'mark_merge_ready',
    entity: toolEntity('mark_merge_ready')
  };
}

export function createMarkMergeReadyHandler(context: ToolExecutionContext) {
  return async function markMergeReady(
    input: unknown
  ): Promise<Result<MarkMergeReadyOutput, ToolDomainError>> {
    const parsedInput = markMergeReadyInputSchema.parse(input);

    if (parsedInput.ready) {
      const label = await addMergeReadyLabel(context, parsedInput.pullRequestNumber);
      if (!label.ok) {
        return err(remapToolError(label.error));
      }
    } else {
      const currentState = await loadMergeReadyState(context, parsedInput.pullRequestNumber);
      if (!currentState.ok) {
        return err(remapToolError(currentState.error));
      }

      if (currentState.value) {
        const label = await removeMergeReadyLabel(context, parsedInput.pullRequestNumber);
        if (!label.ok) {
          return err(remapToolError(label.error));
        }
      }
    }

    return ok({
      ok: true
    });
  };
}
