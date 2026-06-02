import { getPrStatus } from '#root/src/tools/read-model/pr-status.js';
import { getReviewRound } from '#root/src/tools/read-model/get-review-round.js';
import {
  getReviewRoundInputSchema,
  getReviewRoundOutputSchema,
  prStatusInputSchema,
  prStatusOutputSchema
} from '#root/src/tools/schemas.js';
import { defineToolContract } from '#root/src/tools/types.js';

export const toolRegistry = [
  defineToolContract({
    name: 'get_review_round',
    title: 'Review Round',
    description: 'Read the current review round for a pull request.',
    actorScopes: ['agent', 'event_source'] as const,
    inputSchemaName: 'get_review_round.input',
    outputSchemaName: 'get_review_round.output',
    inputSchema: getReviewRoundInputSchema,
    outputSchema: getReviewRoundOutputSchema,
    handler: getReviewRound
  }),
  defineToolContract({
    name: 'pr_status',
    title: 'PR Status',
    description: 'Read advisory status for a pull request.',
    actorScopes: ['agent', 'operator', 'event_source'] as const,
    inputSchemaName: 'pr_status.input',
    outputSchemaName: 'pr_status.output',
    inputSchema: prStatusInputSchema,
    outputSchema: prStatusOutputSchema,
    handler: getPrStatus
  })
] as const;

export type ToolName = (typeof toolRegistry)[number]['name'];

export function getToolContract(name: ToolName) {
  return toolRegistry.find((tool) => tool.name === name);
}
