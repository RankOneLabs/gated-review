import { describe, expect, it } from 'vitest';

import {
  reviewActionsInputSchema,
  reviewActionsOutputSchema,
  reviewDecisionInputSchema,
  reviewDecisionOutputSchema,
  reviewEventInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema,
  reviewStateOutputSchema
} from '../src/tools/schemas.js';

describe('schema validation', () => {
  it('accepts valid review state requests and rejects malformed input', () => {
    expect(reviewStateInputSchema.parse({ reviewId: 'review-123' })).toEqual({
      reviewId: 'review-123'
    });
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
    expect(
      reviewStateOutputSchema.parse({
        reviewId: 'review-123',
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
        reviewId: 'review-123',
        actions: [
          {
            actionId: 'action-1',
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
        reviewId: 'review-123',
        eventId: 'event-1',
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
        reviewId: 'review-123',
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
        reviewId: 'review-123',
        decisionId: 'decision-1',
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
