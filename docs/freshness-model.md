# Freshness Model

`get_review_round` annotates each thread with `hasFreshComments` and the overall round with a `freshSince` timestamp. This document explains how those annotations are produced, what guarantees they carry, and what they do not.

## Two Axes

Freshness is built from two independent signals:

### 1. Unresolved-as-proxy (correctness axis)

A thread is unresolved when GitHub's `isResolved` flag is false. The agent sees every unresolved thread on every call regardless of when the comments were posted. This axis is always live — it is derived directly from GitHub's authoritative state and requires no server-side tracking. It is the safety net: even if the delivery watermark is wrong or absent, unresolved threads still surface.

### 2. `lastDelivered` watermark (ergonomics axis)

The server records the latest `createdAt` timestamp seen across all thread comments returned by a `get_review_round` call. On subsequent calls for the same PR, threads whose most recent comment is newer than that watermark are flagged `hasFreshComments: true`. This lets the agent skip threads it has already seen and acted on, rather than re-reading the entire comment history each round.

`freshSince` in the `get_review_round` response is the watermark value that was in effect when that call was made. It is null on the first call for a PR.

## Storage: In-Memory, Not Persisted

The watermark store (`FreshnessStore`) is a plain `Map` held in server process memory. It is not written to disk, a database, or any external store.

**Why this is safe:**

- On server restart the map is empty, so every thread is treated as fresh on the next `get_review_round` call. This over-flags one round — threads the agent already handled appear fresh again — but it does not under-flag. The agent re-reads known threads; it does not miss new ones.
- The unresolved axis is the correctness safety net. Even after restart, unresolved threads are returned by GitHub directly.
- A crash-after-fetch scenario (server fetches GitHub, crashes before the agent receives the response) causes the watermark to be unrecorded. The next call returns all threads as fresh, which is the conservative outcome.

The trade-off: restart-induced noise (one re-read round per PR) in exchange for zero operational complexity (no database, no volume mount, no migration).

## Lazy Purge on Merge or Close

When `get_review_round` observes that the PR state is `MERGED` or `CLOSED`, it removes the watermark entry for that PR from the store. This is a lazy purge — it happens on the next fetch after the PR closes, not immediately. In-flight entries for open PRs are never evicted proactively.

## Per-PR Cursor Limitation

There is one watermark cursor per `owner/repo#number` key, shared across all MCP sessions connected to the same server process. If two agents call `get_review_round` for the same PR concurrently, the watermark advances to whichever `createdAt` is largest among both calls. Each agent sees the other's delivered timestamp on subsequent calls.

Per-client cursor isolation is explicitly deferred (see [docs/deferred-items.md](deferred-items.md)). In practice, a single agent operates on a given PR at any one time, so cursor sharing is not a problem in the homelab deployment.

## What `review.*` Stubs Do Not Do

The `review.apply_decision` tool (and any other `review.*` stub) does not update the freshness store. The watermark advances only on `get_review_round` calls. Resolving a thread does not advance `freshSince`; the agent must call `get_review_round` again to move the watermark forward.
