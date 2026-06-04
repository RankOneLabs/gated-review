# Deferred Items

These are intentionally out of scope and are not open questions.

## What Shipped (Not Deferred)

A bounded delivery cursor (`lastDelivered` watermark) now lives in the server and drives the `hasFreshComments` annotation on `get_review_round`. This is ergonomics state, not policy state — it does not count rounds or enforce limits. See [docs/freshness-model.md](freshness-model.md) and [docs/review-policy.md](review-policy.md) for the distinction.

## Explicitly Deferred

- **`github_raw`** remains omitted. There is no uncurated passthrough tool.
- **`clone`** is not implemented.
- **`request_next_round`** stays optional and policy-driven rather than mandatory.
- **Webhook or orchestrator receive-side resume** behavior is outside this MCP server.
- **`MergeReady` auto-clear** is deferred to receive-side automation.
- **Review round limits** such as `maxReviewRounds: 3` belong to the orchestrator review policy, not this server.
- **Per-client cursor isolation**: the delivery cursor is shared across all sessions connected to the same server process. Isolating cursors per MCP client session is deferred.
- **Operator web UI**: there is no operator HTTP surface beyond the agent MCP endpoint.
- **Endpoint authentication**: the `/mcp` endpoint has no token or credential check. Access control is provided by the Tailscale tailnet at the network layer.

## Why This Matters

- The server stays bounded and predictable.
- Receive-side concerns remain in the orchestration layer where they belong.
- Future work can be added without weakening the current tool contract.
