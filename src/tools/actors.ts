export const actorScopes = ['agent', 'operator', 'event_source'] as const;

export type ActorScope = (typeof actorScopes)[number];

export function isActorScope(value: string): value is ActorScope {
  return (actorScopes as readonly string[]).includes(value);
}
