# Review Policy

Review policy is orchestrator state, not MCP server state. The MCP server exposes
curated GitHub primitives and shaped read models; it does not count review
rounds, decide when the loop is done, or mark a pull request merge-ready.

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

The server should continue to treat `MergeReady` as a human assertion recorded
with the GitHub `merge-ready` label. `merge_pr` should only enforce that label;
round counting and round-limit recommendations belong in kbbl, oakridge, or
another orchestration layer.
