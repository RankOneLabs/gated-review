# Deferred Items

These are intentionally out of scope for v1 and are not open questions.

## Explicitly Deferred

- `github_raw` remains omitted. There is no uncurated passthrough tool.
- `clone` is not implemented in v1.
- `request_next_round` stays optional and policy-driven rather than mandatory.
- Webhook or orchestrator receive-side resume behavior is outside this MCP server.
- `MergeReady` auto-clear is deferred to receive-side automation.
- Review round limits such as `maxReviewRounds: 3` belong to the orchestrator
  review policy, not this MCP server.

## Why This Matters

- The server stays bounded and predictable.
- Receive-side concerns remain in the orchestration layer where they belong.
- Future work can be added without weakening the current tool contract.
