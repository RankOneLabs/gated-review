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
