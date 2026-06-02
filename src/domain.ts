export type Brand<TName extends string> = string & { readonly __brand: TName };

export type ReviewId = Brand<'ReviewId'>;
export type ActionId = Brand<'ActionId'>;
export type EventId = Brand<'EventId'>;
export type DecisionId = Brand<'DecisionId'>;

export type ToolEntity =
  | { kind: 'tool'; name: string }
  | { kind: 'review'; id: ReviewId }
  | { kind: 'action'; id: ActionId }
  | { kind: 'event'; id: EventId }
  | { kind: 'decision'; id: DecisionId };

