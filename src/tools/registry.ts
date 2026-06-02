import { err } from '#root/src/result.js';
import { notImplementedError } from '#root/src/errors.js';
import {
  reviewActionsInputSchema,
  reviewActionsOutputSchema,
  reviewDecisionInputSchema,
  reviewDecisionOutputSchema,
  reviewEventInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema,
  reviewStateOutputSchema
} from '#root/src/tools/schemas.js';
import type { ToolContract } from '#root/src/tools/types.js';

const notImplemented = (toolName: string) => async (_input: unknown) => {
  return err(notImplementedError(toolName));
};

export const toolRegistry = [
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
  }
] as const satisfies readonly ToolContract<import('zod').ZodTypeAny, import('zod').ZodTypeAny>[];

export type ToolName = (typeof toolRegistry)[number]['name'];

export function getToolContract(name: ToolName) {
  return toolRegistry.find((tool) => tool.name === name);
}
