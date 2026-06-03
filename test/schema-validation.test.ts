import { describe, expect, it } from 'vitest';

import type { ActionId, DecisionId, EventId, ReviewId } from '#root/src/domain.js';
import {
  reviewActionsInputSchema,
  reviewActionsOutputSchema,
  reviewDecisionInputSchema,
  reviewDecisionOutputSchema,
  reviewEventInputSchema,
  reviewEventReceiptOutputSchema,
  reviewIdSchema,
  reviewStateInputSchema,
  reviewStateOutputSchema
} from '#root/src/tools/schemas.js';

describe('schema validation', () => {
  it('accepts valid review state requests and rejects malformed input', () => {
    const parsed = reviewStateInputSchema.parse({ reviewId: 'review-123' });
    const reviewId: ReviewId = parsed.reviewId;

    expect(reviewId).toBe('review-123');
    expect(() => reviewStateInputSchema.parse({ reviewId: '' })).toThrow();
  });

  it('accepts valid event payloads', () => {
    expect(
      reviewEventInputSchema.parse({
        reviewId: 'review-123',
        event: {
          eventType: 'sync.completed',
          payload: { sha: 'abc123', status: 'done' }
        }
      })
    ).toEqual({
      reviewId: 'review-123',
      event: {
        eventType: 'sync.completed',
        payload: { sha: 'abc123', status: 'done' }
      }
    });
    expect(() =>
      reviewEventInputSchema.parse({
        reviewId: 'review-123',
        event: {
          eventType: '',
          payload: {}
        }
      })
    ).toThrow();
  });

  it('accepts shaped output payloads for every registered tool', () => {
    const brandedReviewId: ReviewId = reviewIdSchema.parse('review-123');
    expect(
      reviewStateOutputSchema.parse({
        reviewId: brandedReviewId,
        status: 'queued',
        gate: {
          name: 'triage',
          isOpen: true,
          actorScope: 'agent'
        },
        lastUpdatedAt: '2026-06-02T12:00:00.000Z'
      })
    ).toEqual({
      reviewId: 'review-123',
      status: 'queued',
      gate: {
        name: 'triage',
        isOpen: true,
        actorScope: 'agent'
      },
      lastUpdatedAt: '2026-06-02T12:00:00.000Z'
    });
    expect(
      reviewActionsOutputSchema.parse({
        reviewId: brandedReviewId,
        actions: [
          {
            actionId: 'action-1' as ActionId,
            kind: 'comment',
            actorScope: 'operator',
            createdAt: '2026-06-02T12:00:00.000Z'
          }
        ]
      })
    ).toEqual({
      reviewId: 'review-123',
      actions: [
        {
          actionId: 'action-1',
          kind: 'comment',
          actorScope: 'operator',
          createdAt: '2026-06-02T12:00:00.000Z'
        }
      ]
    });
    expect(
      reviewEventReceiptOutputSchema.parse({
        reviewId: brandedReviewId,
        eventId: 'event-1' as EventId,
        accepted: true,
        receivedAt: '2026-06-02T12:00:00.000Z'
      })
    ).toEqual({
      reviewId: 'review-123',
      eventId: 'event-1',
      accepted: true,
      receivedAt: '2026-06-02T12:00:00.000Z'
    });
    expect(
      reviewDecisionInputSchema.parse({
        reviewId: brandedReviewId,
        decision: 'approve',
        reason: 'policy satisfied'
      })
    ).toEqual({
      reviewId: 'review-123',
      decision: 'approve',
      reason: 'policy satisfied'
    });
    expect(
      reviewDecisionOutputSchema.parse({
        reviewId: brandedReviewId,
        decisionId: 'decision-1' as DecisionId,
        finalStatus: 'approved',
        appliedAt: '2026-06-02T12:00:00.000Z'
      })
    ).toEqual({
        reviewId: 'review-123',
        decisionId: 'decision-1',
        finalStatus: 'approved',
        appliedAt: '2026-06-02T12:00:00.000Z'
      });
    expect(() =>
      reviewActionsInputSchema.parse({
        reviewId: ''
      })
    ).toThrow();
  });
});
