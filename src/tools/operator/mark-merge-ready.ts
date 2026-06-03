import { err, ok, type Result } from '#root/src/result.js';
import { validationRejectedError, toolEntity, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { markMergeReadyInputSchema } from '#root/src/tools/schemas.js';
import { addMergeReadyLabel, removeMergeReadyLabel } from '#root/src/tools/operator/merge-ready.js';
import type { MarkMergeReadyOutput } from '#root/src/tools/types.js';

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
    const parsed = markMergeReadyInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(validationRejectedError('mark_merge_ready', parsed.error.message));
    }

    const parsedInput = parsed.data;

    if (parsedInput.ready) {
      const label = await addMergeReadyLabel(context, parsedInput.pullRequestNumber);
      if (!label.ok) {
        return err(remapToolError(label.error));
      }
    } else {
      const label = await removeMergeReadyLabel(context, parsedInput.pullRequestNumber);
      if (!label.ok) {
        return err(remapToolError(label.error));
      }
    }

    return ok({
      ok: true
    });
  };
}
