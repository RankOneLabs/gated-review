import { z } from 'zod';

export const reviewStatusSchema = z
  .enum(['queued', 'blocked', 'approved', 'changes_requested'])
  .describe('review.get_state.output.status');

export const reviewDecisionSchema = z
  .enum(['approve', 'request_changes', 'block'])
  .describe('review.apply_decision.input.decision');

export const reviewStateInputSchema = z
  .object({
    reviewId: z.string().min(1)
  })
  .strict()
  .describe('review.get_state.input');

export const reviewStateOutputSchema = z
  .object({
    reviewId: z.string().min(1),
    status: reviewStatusSchema,
    gate: z.object({
      name: z.string().min(1),
      isOpen: z.boolean(),
      actorScope: z.enum(['agent', 'operator', 'event_source'])
    }),
    lastUpdatedAt: z.string().datetime()
  })
  .strict()
  .describe('review.get_state.output');

export const reviewActionsInputSchema = z
  .object({
    reviewId: z.string().min(1)
  })
  .strict()
  .describe('review.list_actions.input');

export const reviewActionSchema = z
  .object({
    actionId: z.string().min(1),
    kind: z.string().min(1),
    actorScope: z.enum(['agent', 'operator', 'event_source']),
    createdAt: z.string().datetime()
  })
  .strict();

export const reviewActionsOutputSchema = z
  .object({
    reviewId: z.string().min(1),
    actions: z.array(reviewActionSchema)
  })
  .strict()
  .describe('review.list_actions.output');

export const reviewEventInputSchema = z
  .object({
    reviewId: z.string().min(1),
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
    reviewId: z.string().min(1),
    eventId: z.string().min(1),
    accepted: z.boolean(),
    receivedAt: z.string().datetime()
  })
  .strict()
  .describe('review.record_event.output');

export const reviewDecisionInputSchema = z
  .object({
    reviewId: z.string().min(1),
    decision: reviewDecisionSchema,
    reason: z.string().min(1).optional()
  })
  .strict()
  .describe('review.apply_decision.input');

export const reviewDecisionOutputSchema = z
  .object({
    reviewId: z.string().min(1),
    decisionId: z.string().min(1),
    finalStatus: reviewStatusSchema,
    appliedAt: z.string().datetime()
  })
  .strict()
  .describe('review.apply_decision.output');
