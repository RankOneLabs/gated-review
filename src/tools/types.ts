import type * as z from 'zod';

import type {
  reviewActionsInputSchema,
  reviewActionsOutputSchema,
  reviewDecisionInputSchema,
  reviewDecisionOutputSchema,
  reviewEventInputSchema,
  reviewEventReceiptOutputSchema,
  reviewStateInputSchema,
  reviewStateOutputSchema
} from './schemas.js';
import type { ActorScope } from './actors.js';

export type ReviewStateInput = z.infer<typeof reviewStateInputSchema>;
export type ReviewStateOutput = z.infer<typeof reviewStateOutputSchema>;

export type ReviewActionsInput = z.infer<typeof reviewActionsInputSchema>;
export type ReviewActionsOutput = z.infer<typeof reviewActionsOutputSchema>;

export type ReviewEventInput = z.infer<typeof reviewEventInputSchema>;
export type ReviewEventReceiptOutput = z.infer<typeof reviewEventReceiptOutputSchema>;

export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;
export type ReviewDecisionOutput = z.infer<typeof reviewDecisionOutputSchema>;

export interface ToolContract<TInputSchema extends z.ZodTypeAny, TOutputSchema extends z.ZodTypeAny> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly actorScopes: readonly ActorScope[];
  readonly inputSchemaName: string;
  readonly outputSchemaName: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly handler: (input: z.infer<TInputSchema>) => Promise<z.infer<TOutputSchema>>;
}
