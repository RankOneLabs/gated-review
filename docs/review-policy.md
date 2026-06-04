# Review Policy

Review policy is orchestrator state, not MCP server state. The MCP server exposes
curated GitHub primitives and shaped read models; it does not count review
rounds, decide when the loop is done, or mark a pull request merge-ready.

## What the Server Does Hold

The server holds one bounded, non-policy piece of per-PR state: a **delivery
cursor** (`lastDelivered` watermark) that records the latest review-thread comment timestamp
seen on the last `get_review_round` call. This cursor drives the
`hasFreshComments` annotation and is described fully in
[docs/freshness-model.md](freshness-model.md).

The delivery cursor is ergonomics, not policy: it tells the agent which threads
it has already seen, but it does not count rounds, enforce limits, or gate any
operator action. It is held in memory (not persisted) for the server lifetime.

## What the Server Does Not Hold

- **Round count**: the server does not count how many triage invocations have
  happened for a PR.
- **Round policy / `maxReviewRounds`**: enforcement of round limits belongs to
  the orchestrator (kbbl, oakridge, or another layer), not this server.
- **MergeReady logic**: `merge_pr` enforces only that the `merge-ready` label
  is present; whether to set that label is a human decision.

## Max Review Rounds

Orchestrators may cap the number of operator-bounded review rounds with a
configuration value such as:

```ts
type ReviewPolicy = {
  maxReviewRounds: number;
};
```

The default recommendation is `3`.

A review round is counted when the operator invokes triage. That invocation is
the round boundary; incoming comments or webhook events do not create rounds by
themselves.

## Recommended Flow

1. The operator invokes triage for a pull request.
2. The orchestrator records the round number for that PR.
3. The triage skill calls `get_review_round`.
4. If the recorded round count reaches `maxReviewRounds`, the operator surface
   should recommend a MergeReady decision instead of another review cycle.
5. The operator still decides whether to call `mark_merge_ready`, request
   another round, or continue fixing comments.

`maxReviewRounds` is advisory. It must not automatically set `merge-ready`, call
`merge_pr`, resolve threads, or suppress human gates.

## Server Boundary

The server continues to treat `MergeReady` as a human assertion recorded with
the GitHub `merge-ready` label. `merge_pr` enforces only that label; round
counting and round-limit recommendations belong in the orchestration layer.

The delivery cursor is the only per-PR state the server holds. Everything else
— round counts, policy decisions, client-specific cursors — remains in the
orchestration layer or is explicitly deferred (see
[docs/deferred-items.md](deferred-items.md)).
