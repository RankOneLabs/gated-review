import { describe, expect, it } from 'vitest';

import type { ReviewId } from '#root/src/domain.js';
import { actorScopes } from '#root/src/tools/actors.js';
import { toolRegistry } from '#root/src/tools/registry.js';
import {
  reviewActionSchema,
  reviewDecisionInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema
} from '#root/src/tools/schemas.js';
import type { ToolContract } from '#root/src/tools/types.js';
import type { ZodTypeAny } from 'zod';

async function runStubHandler(tool: ToolContract<ZodTypeAny, ZodTypeAny, string>) {
  const input = tool.inputSchema.parse(
    tool.name === 'review.record_event'
      ? {
          reviewId: 'review-123',
          event: {
            eventType: 'sync.completed',
            payload: { status: 'done' }
          }
        }
      : tool.name === 'review.apply_decision'
        ? {
            reviewId: 'review-123',
            decision: 'approve',
            reason: 'policy satisfied'
          }
        : {
            reviewId: 'review-123'
          }
  );

  return tool.handler(input);
}

describe('tool contracts', () => {
  it('exposes a narrow curated tool surface', () => {
    expect(toolRegistry.map((tool) => tool.name)).toEqual([
      'review.get_state',
      'review.list_actions',
      'review.record_event',
      'review.apply_decision',
      'git.push',
      'git.pull',
      'git.fetch'
    ]);
    expect(toolRegistry.map((tool) => tool.name)).not.toContain('github_raw');
  });

  it('publishes actor scope metadata for each tool', () => {
    expect(toolRegistry.find((tool) => tool.name === 'review.get_state')?.actorScopes).toEqual(
      actorScopes
    );
    expect(toolRegistry.find((tool) => tool.name === 'review.list_actions')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'review.record_event')?.actorScopes).toEqual([
      'event_source'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'review.apply_decision')?.actorScopes).toEqual([
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'git.push')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'git.pull')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'git.fetch')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
  });

  it('keeps the shaped output schema names explicit', () => {
    expect(toolRegistry.map((tool) => tool.outputSchemaName)).toEqual([
      'review.get_state.output',
      'review.list_actions.output',
      'review.record_event.output',
      'review.apply_decision.output',
      'git.push.output',
      'git.pull.output',
      'git.fetch.output'
    ]);
  });

  it('brands the domain ids in the schema output types', () => {
    const state = reviewStateInputSchema.parse({ reviewId: 'review-123' });
    const stateReviewId: ReviewId = state.reviewId;

    const action = reviewActionSchema.parse({
      actionId: 'action-123',
      kind: 'comment',
      actorScope: 'operator',
      createdAt: '2026-06-02T12:00:00.000Z'
    });
    const actionId = action.actionId;

    const event = reviewEventReceiptOutputSchema.parse({
      reviewId: 'review-123',
      eventId: 'event-123',
      accepted: true,
      receivedAt: '2026-06-02T12:00:00.000Z'
    });
    const eventId = event.eventId;

    const decision = reviewDecisionInputSchema.parse({
      reviewId: 'review-123',
      decision: 'approve',
      reason: 'looks good'
    });
    const decisionReviewId: ReviewId = decision.reviewId;

    expect(stateReviewId).toBe('review-123');
    expect(actionId).toBe('action-123');
    expect(eventId).toBe('event-123');
    expect(decisionReviewId).toBe('review-123');
  });

  it('returns result values with domain errors for the review stub handlers', async () => {
    const reviewTools = toolRegistry.filter((tool) => tool.name.startsWith('review.')) as readonly ToolContract<
      ZodTypeAny,
      ZodTypeAny,
      string
    >[];
    const results = await Promise.all(reviewTools.map(async (tool) => runStubHandler(tool)));

    expect(results).toHaveLength(reviewTools.length);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('not_implemented');
        expect(result.error.operation).toMatch(/^review\./);
        expect(result.error.entity).toEqual({ kind: 'tool', name: result.error.operation });
      }
    }
  });
});
