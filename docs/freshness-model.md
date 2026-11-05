# Freshness Model

`get_review_round` returns every open review thread with its complete comment history on every call. With `includeResolved: true`, it also returns every resolved thread and its comment history. Freshness annotates results with `hasFreshComments` and `freshSince`; it never filters threads or comments. Fetching feedback does not mean it has been handled.

Thread comments whose author is unavailable are retained with `author: null`,
matching GitHub's nullable author field. Both the thread list and each thread's
comments are paginated through all pages.

## Two Axes

Freshness is built from two independent signals:

### 1. Unresolved-as-proxy (correctness axis)

A thread is unresolved when GitHub's `isResolved` flag is false. The server returns and counts every unresolved thread on every call regardless of when the comments were posted. This axis is always live — it is derived directly from GitHub's authoritative state and requires no server-side tracking. Resolving a thread is how handled work leaves the default response.

### 2. `lastDelivered` watermark (ergonomics axis)

The server records the latest `createdAt` timestamp seen across all review-thread comments fetched by a `get_review_round` call. Summary comments (issue comments from CodeRabbit or Copilot) are returned in the response but do not advance the watermark. An open thread has `hasFreshComments: true` when it contains a comment newer than the prior watermark, or has comments and no valid prior watermark exists. Resolved threads have `hasFreshComments: false`. Older comments remain available as context, and threads with no fresh comments are still returned.

`freshSince` in the `get_review_round` response is the valid watermark value used to compute annotations for that call. It is null on the first call for a PR. If stored freshness state is invalid or unparseable, the server treats it as absent and returns `freshSince: null`. This timestamp is an advisory freshness signal, not an acknowledgement or proof that any particular client has seen or handled feedback.

If an individual review comment has an unparseable `createdAt`, the server treats that comment as fresh. Invalid comment timestamps do not advance the stored watermark.

## Storage: In-Memory, Not Persisted

The watermark store (`FreshnessStore`) is a plain `Map` held in server process memory. It is not written to disk, a database, or any external store.

**Why this is safe:**

- On server restart the map is empty, so open threads with comments are annotated as fresh on the next `get_review_round` call.
- Threads and comments are always returned independently of the watermark. A lost response or another client's read cannot hide feedback from subsequent reads.
- Both thread inclusion and `openThreadCount` are derived directly from GitHub.

The trade-off is restart-induced fresh markers in exchange for zero operational complexity (no database, no volume mount, no migration).

## Lazy Purge on Merge or Close

When `get_review_round` observes that the PR state is `MERGED` or `CLOSED`, it removes the watermark entry for that PR from the store. This is a lazy purge — it happens on the next fetch after the PR closes, not immediately. In-flight entries for open PRs are never evicted proactively.

## Per-PR Cursor Limitation

There is one watermark cursor per `owner/repo#number` key, shared across all MCP sessions connected to the same server process. If two agents call `get_review_round` for the same PR concurrently, the watermark advances to whichever `createdAt` is largest among both calls. Each agent sees the other's delivered timestamp on subsequent calls.

Per-client cursor isolation is explicitly deferred (see [docs/deferred-items.md](deferred-items.md)). Cursor sharing can affect fresh markers, but cannot affect which threads or comments a client receives. Clients must inspect all open threads even when `hasFreshComments` is false.

## What `review.*` Stubs Do Not Do

The `review.apply_decision` tool (and any other `review.*` stub) does not update the freshness store. The watermark advances only on `get_review_round` calls. Resolving a thread does not advance `freshSince`; the agent must call `get_review_round` again to move the watermark forward.
