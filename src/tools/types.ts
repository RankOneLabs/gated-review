import type * as z from 'zod';

import type { Result } from '#root/src/result.js';
import type { ToolDomainError } from '#root/src/errors.js';
import {
  getReviewRoundInputSchema,
  getReviewRoundOutputSchema,
  markMergeReadyInputSchema,
  markMergeReadyOutputSchema,
  mergePrInputSchema,
  mergePrOutputSchema,
  prStatusInputSchema,
  prStatusOutputSchema,
  requestCopilotReviewInputSchema,
  requestCopilotReviewOutputSchema,
  reviewActionsInputSchema,
  reviewActionsOutputSchema,
  reviewDecisionInputSchema,
  reviewDecisionOutputSchema,
  reviewEventInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema,
  reviewStateOutputSchema
} from '#root/src/tools/schemas.js';
import type { ActorScope } from '#root/src/tools/actors.js';

export type ReviewStateInput = z.infer<typeof reviewStateInputSchema>;
export type ReviewStateOutput = z.infer<typeof reviewStateOutputSchema>;

export type ReviewActionsInput = z.infer<typeof reviewActionsInputSchema>;
export type ReviewActionsOutput = z.infer<typeof reviewActionsOutputSchema>;

export type ReviewEventInput = z.infer<typeof reviewEventInputSchema>;
export type ReviewEventReceiptOutput = z.infer<typeof reviewEventReceiptOutputSchema>;

export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;
export type ReviewDecisionOutput = z.infer<typeof reviewDecisionOutputSchema>;

export type RequestCopilotReviewInput = z.infer<typeof requestCopilotReviewInputSchema>;
export type RequestCopilotReviewOutput = z.infer<typeof requestCopilotReviewOutputSchema>;

export type MarkMergeReadyInput = z.infer<typeof markMergeReadyInputSchema>;
export type MarkMergeReadyOutput = z.infer<typeof markMergeReadyOutputSchema>;

export type MergePrInput = z.infer<typeof mergePrInputSchema>;
export type MergePrOutput = z.infer<typeof mergePrOutputSchema>;

export type GetReviewRoundInput = z.input<typeof getReviewRoundInputSchema>;
export type GetReviewRoundOutput = z.infer<typeof getReviewRoundOutputSchema>;

export type PrStatusInput = z.input<typeof prStatusInputSchema>;
export type PrStatusOutput = z.infer<typeof prStatusOutputSchema>;

export interface ToolContract<
  TInputSchema extends z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny,
  TName extends string = string
> {
  readonly name: TName;
  readonly title: string;
  readonly description: string;
  readonly actorScopes: readonly ActorScope[];
  readonly inputSchemaName: string;
  readonly outputSchemaName: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly handler: (
    input: z.output<TInputSchema>
  ) => Promise<Result<z.output<TOutputSchema>, ToolDomainError>>;
}

export function defineToolContract<TInputSchema extends z.ZodTypeAny, TOutputSchema extends z.ZodTypeAny>(
  contract: ToolContract<TInputSchema, TOutputSchema>
) {
  return contract;
}
