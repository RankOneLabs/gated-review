import type * as z from 'zod';

import { err } from '#root/src/result.js';
import { notImplementedError } from '#root/src/errors.js';
import { gitFetchTool } from '#root/src/tools/git/fetch.js';
import { gitPullTool } from '#root/src/tools/git/pull.js';
import { gitPushTool } from '#root/src/tools/git/push.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import {
  getReviewRoundInputSchema,
  getReviewRoundOutputSchema,
  prStatusInputSchema,
  prStatusOutputSchema,
  reviewActionsInputSchema,
  reviewActionsOutputSchema,
  reviewDecisionInputSchema,
  reviewDecisionOutputSchema,
  reviewEventInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema,
  reviewStateOutputSchema
} from '#root/src/tools/schemas.js';
import {
  createOpenPrHandler,
  openPrInputSchema,
  openPrOutputSchema
} from '#root/src/tools/mutations/open-pr.js';
import {
  createReplyToThreadHandler,
  replyToThreadInputSchema,
  replyToThreadOutputSchema
} from '#root/src/tools/mutations/reply-to-thread.js';
import {
  createResolveThreadHandler,
  resolveThreadInputSchema,
  resolveThreadOutputSchema
} from '#root/src/tools/mutations/resolve-thread.js';
import {
  createRequestNextRoundHandler,
  requestNextRoundInputSchema,
  requestNextRoundOutputSchema
} from '#root/src/tools/mutations/request-next-round.js';
import { createRequestCopilotReviewHandler } from '#root/src/tools/operator/request-copilot-review.js';
import { createMarkMergeReadyHandler } from '#root/src/tools/operator/mark-merge-ready.js';
import { createMergePrHandler } from '#root/src/tools/operator/merge-pr.js';
import type { ToolContract } from '#root/src/tools/types.js';
import { getPrStatus } from '#root/src/tools/read-model/pr-status.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import {
  markMergeReadyInputSchema,
  markMergeReadyOutputSchema,
  mergePrInputSchema,
  mergePrOutputSchema,
  requestCopilotReviewInputSchema,
  requestCopilotReviewOutputSchema
} from '#root/src/tools/schemas.js';

const notImplemented = (toolName: string) => async (_input: unknown) => {
  return err(notImplementedError(toolName));
};

export function createToolRegistry(context: ToolExecutionContext) {
  return [
    {
      name: 'review.get_state',
      title: 'Review State',
      description: 'Read the current gated-review state for a review thread.',
      actorScopes: ['agent', 'operator', 'event_source'] as const,
      inputSchemaName: 'review.get_state.input',
      outputSchemaName: 'review.get_state.output',
      inputSchema: reviewStateInputSchema,
      outputSchema: reviewStateOutputSchema,
      handler: notImplemented('review.get_state')
    },
    {
      name: 'review.list_actions',
      title: 'Review Actions',
      description: 'List curated actions that have been taken for a review thread.',
      actorScopes: ['agent', 'operator'] as const,
      inputSchemaName: 'review.list_actions.input',
      outputSchemaName: 'review.list_actions.output',
      inputSchema: reviewActionsInputSchema,
      outputSchema: reviewActionsOutputSchema,
      handler: notImplemented('review.list_actions')
    },
    {
      name: 'review.record_event',
      title: 'Review Event',
      description: 'Record a review event from an external source.',
      actorScopes: ['event_source'] as const,
      inputSchemaName: 'review.record_event.input',
      outputSchemaName: 'review.record_event.output',
      inputSchema: reviewEventInputSchema,
      outputSchema: reviewEventReceiptOutputSchema,
      handler: notImplemented('review.record_event')
    },
    {
      name: 'review.apply_decision',
      title: 'Apply Review Decision',
      description: 'Apply an operator decision to a gated review.',
      actorScopes: ['operator'] as const,
      inputSchemaName: 'review.apply_decision.input',
      outputSchemaName: 'review.apply_decision.output',
      inputSchema: reviewDecisionInputSchema,
      outputSchema: reviewDecisionOutputSchema,
      handler: notImplemented('review.apply_decision')
    },
    {
      name: 'open_pr',
      title: 'Open Pull Request',
      description: 'Open a pull request. Requires repository as an owner/name slug.',
      actorScopes: ['agent'] as const,
      inputSchemaName: 'open_pr.input',
      outputSchemaName: 'open_pr.output',
      inputSchema: openPrInputSchema,
      outputSchema: openPrOutputSchema,
      handler: createOpenPrHandler(context)
    },
    {
      name: 'reply_to_thread',
      title: 'Reply To Thread',
      description: 'Reply to a GitHub review thread. Requires repository as an owner/name slug.',
      actorScopes: ['agent'] as const,
      inputSchemaName: 'reply_to_thread.input',
      outputSchemaName: 'reply_to_thread.output',
      inputSchema: replyToThreadInputSchema,
      outputSchema: replyToThreadOutputSchema,
      handler: createReplyToThreadHandler(context)
    },
    {
      name: 'resolve_thread',
      title: 'Resolve Thread',
      description: 'Resolve a review thread once you have actually handled it (fix pushed, or operator-approved ignore). Unresolved threads are the agent inbox; resolving is how a handled thread leaves it. Requires repository as an owner/name slug.',
      actorScopes: ['agent'] as const,
      inputSchemaName: 'resolve_thread.input',
      outputSchemaName: 'resolve_thread.output',
      inputSchema: resolveThreadInputSchema,
      outputSchema: resolveThreadOutputSchema,
      handler: createResolveThreadHandler(context)
    },
    {
      name: 'request_next_round',
      title: 'Request Next Round',
      description: 'Request another Copilot review round on a pull request. Requires repository as an owner/name slug.',
      actorScopes: ['agent'] as const,
      inputSchemaName: 'request_next_round.input',
      outputSchemaName: 'request_next_round.output',
      inputSchema: requestNextRoundInputSchema,
      outputSchema: requestNextRoundOutputSchema,
      handler: createRequestNextRoundHandler(context)
    },
    {
      name: 'request_copilot_review',
      title: 'Request Copilot Review',
      description: 'Request a Copilot review on a pull request.',
      actorScopes: ['operator'] as const,
      inputSchemaName: 'request_copilot_review.input',
      outputSchemaName: 'request_copilot_review.output',
      inputSchema: requestCopilotReviewInputSchema,
      outputSchema: requestCopilotReviewOutputSchema,
      handler: createRequestCopilotReviewHandler(context)
    },
    {
      name: 'mark_merge_ready',
      title: 'Mark Merge Ready',
      description: 'Set or clear the merge-ready label on a pull request.',
      actorScopes: ['operator'] as const,
      inputSchemaName: 'mark_merge_ready.input',
      outputSchemaName: 'mark_merge_ready.output',
      inputSchema: markMergeReadyInputSchema,
      outputSchema: markMergeReadyOutputSchema,
      handler: createMarkMergeReadyHandler(context)
    },
    {
      name: 'merge_pr',
      title: 'Merge Pull Request',
      description: 'Merge a pull request after the merge-ready gate is set.',
      actorScopes: ['operator'] as const,
      inputSchemaName: 'merge_pr.input',
      outputSchemaName: 'merge_pr.output',
      inputSchema: mergePrInputSchema,
      outputSchema: mergePrOutputSchema,
      handler: createMergePrHandler(context)
    },
    {
      name: 'git.push',
      title: 'Git Push',
      description: 'Push a branch to origin through the server (remote credentials stay server-side). Do NOT use git push/pull/fetch in the shell or GitHub CLI (gh) for remote operations. Requires repository as an owner/name slug.',
      actorScopes: ['agent', 'operator'] as const,
      inputSchemaName: 'git.push.input',
      outputSchemaName: 'git.push.output',
      inputSchema: gitPushTool.inputSchema,
      outputSchema: gitPushTool.outputSchema,
      handler: (input) => gitPushTool.handler(input as Parameters<typeof gitPushTool.handler>[0])
    },
    {
      name: 'git.pull',
      title: 'Git Pull',
      description: 'Pull a branch from origin through the server (remote credentials stay server-side). Do NOT use git push/pull/fetch in the shell or GitHub CLI (gh) for remote operations. Requires repository as an owner/name slug.',
      actorScopes: ['agent', 'operator'] as const,
      inputSchemaName: 'git.pull.input',
      outputSchemaName: 'git.pull.output',
      inputSchema: gitPullTool.inputSchema,
      outputSchema: gitPullTool.outputSchema,
      handler: (input) => gitPullTool.handler(input as Parameters<typeof gitPullTool.handler>[0])
    },
    {
      name: 'git.fetch',
      title: 'Git Fetch',
      description: 'Fetch a refspec from origin through the server (remote credentials stay server-side). Do NOT use git push/pull/fetch in the shell or GitHub CLI (gh) for remote operations. Requires repository as an owner/name slug.',
      actorScopes: ['agent', 'operator'] as const,
      inputSchemaName: 'git.fetch.input',
      outputSchemaName: 'git.fetch.output',
      inputSchema: gitFetchTool.inputSchema,
      outputSchema: gitFetchTool.outputSchema,
      handler: (input) => gitFetchTool.handler(input as Parameters<typeof gitFetchTool.handler>[0])
    },
    {
      name: 'get_review_round',
      title: 'Review Round',
      description:
        'Read the current review round for a pull request and return the required triage prompt for grouping comments into fix, discuss, or ignore. Requires repository as an owner/name slug.',
      actorScopes: ['agent', 'event_source'] as const,
      inputSchemaName: 'get_review_round.input',
      outputSchemaName: 'get_review_round.output',
      inputSchema: getReviewRoundInputSchema,
      outputSchema: getReviewRoundOutputSchema,
      handler: (input) => getReviewRound(input, context)
    },
    {
      name: 'pr_status',
      title: 'PR Status',
      description: 'Read advisory status for a pull request. Requires repository as an owner/name slug.',
      actorScopes: ['agent', 'operator', 'event_source'] as const,
      inputSchemaName: 'pr_status.input',
      outputSchemaName: 'pr_status.output',
      inputSchema: prStatusInputSchema,
      outputSchema: prStatusOutputSchema,
      handler: (input) => getPrStatus(input, context)
    }
  ] as const satisfies readonly ToolContract<z.ZodTypeAny, z.ZodTypeAny, string>[];
}

export type ToolName = ReturnType<typeof createToolRegistry>[number]['name'];

export function getToolContract(name: ToolName, context: ToolExecutionContext) {
  return createToolRegistry(context).find((tool) => tool.name === name);
}
