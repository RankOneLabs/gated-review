import { z } from 'zod';
import type { ActionId, DecisionId, EventId, ReviewId } from '#root/src/domain.js';
import { actorScopes } from '#root/src/tools/actors.js';

export const reviewIdSchema = z.string().min(1).transform((value): ReviewId => value as ReviewId);
export const actionIdSchema = z.string().min(1).transform((value): ActionId => value as ActionId);
export const eventIdSchema = z.string().min(1).transform((value): EventId => value as EventId);
export const decisionIdSchema = z
  .string()
  .min(1)
  .transform((value): DecisionId => value as DecisionId);

export const reviewStatusSchema = z
  .enum(['queued', 'blocked', 'approved', 'request_changes'])
  .describe('review.get_state.output.status');

export const reviewDecisionSchema = z
  .enum(['approve', 'request_changes', 'block'])
  .describe('review.apply_decision.input.decision');

export const reviewStateInputSchema = z
  .object({
    reviewId: reviewIdSchema
  })
  .strict()
  .describe('review.get_state.input');

export const reviewStateOutputSchema = z
  .object({
    reviewId: reviewIdSchema,
    status: reviewStatusSchema,
    gate: z
      .object({
        name: z.string().min(1),
        isOpen: z.boolean(),
        actorScope: z.enum(actorScopes)
      })
      .strict(),
    lastUpdatedAt: z.string().datetime()
  })
  .strict()
  .describe('review.get_state.output');

export const reviewActionsInputSchema = z
  .object({
    reviewId: reviewIdSchema
  })
  .strict()
  .describe('review.list_actions.input');

export const reviewActionSchema = z
  .object({
    actionId: actionIdSchema,
    kind: z.string().min(1),
    actorScope: z.enum(actorScopes),
    createdAt: z.string().datetime()
  })
  .strict();

export const reviewActionsOutputSchema = z
  .object({
    reviewId: reviewIdSchema,
    actions: z.array(reviewActionSchema)
  })
  .strict()
  .describe('review.list_actions.output');

export const reviewEventInputSchema = z
  .object({
    reviewId: reviewIdSchema,
    event: z
      .object({
        eventType: z.string().min(1),
        payload: z.record(z.string(), z.unknown())
      })
      .strict()
  })
  .strict()
  .describe('review.record_event.input');

export const reviewEventReceiptOutputSchema = z
  .object({
    reviewId: reviewIdSchema,
    eventId: eventIdSchema,
    accepted: z.boolean(),
    receivedAt: z.string().datetime()
  })
  .strict()
  .describe('review.record_event.output');

export const reviewDecisionInputSchema = z
  .object({
    reviewId: reviewIdSchema,
    decision: reviewDecisionSchema,
    reason: z.string().min(1).optional()
  })
  .strict()
  .describe('review.apply_decision.input');

export const reviewDecisionOutputSchema = z
  .object({
    reviewId: reviewIdSchema,
    decisionId: decisionIdSchema,
    finalStatus: reviewStatusSchema,
    appliedAt: z.string().datetime()
  })
  .strict()
  .describe('review.apply_decision.output');

export const requestCopilotReviewInputSchema = z
  .object({
    repository: z.string().min(1),
    pullRequestNumber: z.number().int().positive()
  })
  .strict()
  .describe('request_copilot_review.input');

export const requestCopilotReviewOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('request_copilot_review.output');

export const markMergeReadyInputSchema = z
  .object({
    repository: z.string().min(1),
    pullRequestNumber: z.number().int().positive(),
    ready: z.boolean()
  })
  .strict()
  .describe('mark_merge_ready.input');

export const markMergeReadyOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('mark_merge_ready.output');

export const mergePrMergeMethodSchema = z
  .enum(['merge', 'squash', 'rebase'])
  .describe('merge_pr.input.mergeMethod');

export const mergePrInputSchema = z
  .object({
    repository: z.string().min(1),
    pullRequestNumber: z.number().int().positive(),
    mergeMethod: mergePrMergeMethodSchema,
    commitTitle: z.string().min(1).optional(),
    commitMessage: z.string().min(1).optional(),
    sha: z.string().min(1).optional()
  })
  .strict()
  .describe('merge_pr.input');

export const mergePrOutputSchema = z
  .object({
    merged: z.boolean(),
    sha: z.string().min(1)
  })
  .strict()
  .describe('merge_pr.output');

export const readModelEntityKindSchema = z.enum(['coderabbit', 'copilot', 'human']);

export const readModelEntitySchema = z
  .object({
    login: z.string().min(1),
    kind: readModelEntityKindSchema
  })
  .strict();

export const readModelThreadStateSchema = z.enum(['open', 'resolved']);

export const readModelThreadCommentSchema = z
  .object({
    id: z.string().min(1),
    body: z.string(),
    createdAt: z.string().datetime(),
    author: readModelEntitySchema
  })
  .strict();

export const readModelReviewThreadSchema = z
  .object({
    id: z.string().min(1),
    state: readModelThreadStateSchema,
    path: z.string().min(1).nullable(),
    line: z.number().int().nullable(),
    hasFreshComments: z.boolean(),
    comments: z.array(readModelThreadCommentSchema)
  })
  .strict();

export const readModelSummaryCommentSchema = z
  .object({
    id: z.string().min(1),
    body: z.string(),
    createdAt: z.string().datetime(),
    author: readModelEntitySchema
  })
  .strict();

export const readModelChecksContextSchema = z
  .object({
    context: z.string().min(1),
    state: z.enum(['success', 'failure', 'error', 'pending'])
  })
  .strict();

export const readModelChecksSummarySchema = z
  .object({
    state: z.enum(['passing', 'failing', 'pending']),
    totalCount: z.number().int().nonnegative(),
    failingCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    contexts: z.array(readModelChecksContextSchema)
  })
  .strict();

export const mergeReadyStateSchema = z
  .object({
    isReady: z.boolean(),
    source: z.literal('github_label'),
    label: z.literal('merge-ready')
  })
  .strict();

export const getReviewRoundInputSchema = z
  .object({
    repository: z.string().min(1),
    pullRequestNumber: z.number().int().positive(),
    includeResolved: z.boolean().optional()
  })
  .strict()
  .describe('get_review_round.input');

export const getReviewRoundOutputSchema = z
  .object({
    pullRequestNumber: z.number().int().positive(),
    includeResolved: z.boolean(),
    openThreadCount: z.number().int().nonnegative(),
    freshSince: z.string().datetime().nullable(),
    threads: z.array(readModelReviewThreadSchema),
    summaries: z.array(readModelSummaryCommentSchema)
  })
  .strict()
  .describe('get_review_round.output');

export const prStatusInputSchema = z
  .object({
    repository: z.string().min(1),
    pullRequestNumber: z.number().int().positive()
  })
  .strict()
  .describe('pr_status.input');

export const prStatusOutputSchema = z
  .object({
    pullRequestNumber: z.number().int().positive(),
    openThreadCount: z.number().int().nonnegative(),
    mergeReady: mergeReadyStateSchema,
    checks: readModelChecksSummarySchema
  })
  .strict()
  .describe('pr_status.output');
