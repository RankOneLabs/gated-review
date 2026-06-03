---
name: gated-rev
description: >
  Fetch, evaluate, and triage PR review comments through the gated-review MCP
  server. Use when the gated-review MCP server is available; routes all PR and
  remote-git operations through it. For repos without the server, use ghreview
  instead.
argument-hint: <owner/repo> <pr-number>
---

# Gated PR Review

Fetch and triage all review comments for `$ARGUMENTS` (format: `owner/repo pr-number`)
entirely through the gated-review MCP server. Never use `gh`, raw `git push/pull/fetch`,
or the GitHub API directly.

Parse the arguments:
- `REPO` = first argument (e.g. `acme/my-service`)
- `PR` = second argument as an **integer** (e.g. `42`) — `get_review_round` requires
  `pullRequestNumber` to be a number, not a string; convert before calling.

## Hard Boundaries

These are non-negotiable constraints, not preferences:

- **All PR and remote-git operations go through the MCP server.** Never call `gh`,
  never shell out `git push/pull/fetch`, never hit the GitHub API directly.
- **Remote git operations use `git.push`, `git.pull`, `git.fetch` only.** These route
  credentials server-side.
- **Merging and merge-ready are human-only.** `merge_pr` and `mark_merge_ready` are
  not on the agent tool surface. Never attempt to merge, mark a PR ready, or request
  Copilot review — hand these decisions to the operator.
- **If new comments appear mid-session, stop and re-triage.** Do not continue acting
  on a stale snapshot.

## Fetch

Call `get_review_round` once with `{ repository: REPO, pullRequestNumber: PR }`.

The response envelope contains:
- `threads` — review threads, each with `state` (open/resolved), `path`, `line`,
  `hasFreshComments`, and `comments` (array with `author.kind`, `author.login`, `body`,
  `createdAt`)
- `openThreadCount` — total unresolved threads
- `freshSince` — watermark timestamp; threads with `hasFreshComments: true` arrived
  after this watermark
- `summaries` — top-level summary comments from CodeRabbit or Copilot

Focus triage on open threads (`state: "open"`). If `hasFreshComments` is true on a
thread, flag it as new in the presentation. If `freshSince` is null, all threads are
new.

## Evaluate

Read every open thread and its comments. For each thread, determine the right bucket:

- **fix** — Clear, correct feedback. You know exactly what to change.
- **discuss** — Ambiguous, architectural, or you disagree. Needs operator input.
- **ignore** — Nitpicks, style preferences, or already addressed. Requires
  operator approval before resolving.

Read any `summaries` from CodeRabbit/Copilot for additional context but treat them
as supplementary, not as threads to bucket.

## Present

Show all open threads grouped by bucket. Mark threads with `hasFreshComments: true`
with `[NEW]`.

```
## Fix (N)
1. `path:line` — @author [NEW]: "comment summary"
   → Proposed fix: brief description of what you'll change

2. `path:line` — @author: "comment summary"
   → Proposed fix: brief description

## Discuss (N)
3. `path:line` — @author: "comment summary"
   → Why: reason this needs operator input

## Ignore (N)
4. `path:line` — @author: "comment summary"
   → Why: reason to skip
```

If there are CodeRabbit/Copilot summaries worth noting, append a brief **Summaries**
section after the buckets.

Then stop and wait for the operator's response.

## Act

The operator will reply with adjustments. Examples:
- "looks good, go" — apply all fixes as proposed
- "move 3 to fix, do X" — re-bucket and apply
- "fix all except 2, ignore 4" — partial approve

Apply only what the operator has approved. Follow resolve-discipline exactly:

### Resolve-discipline

Unresolved threads are the agent inbox. Resolving is how a handled thread leaves it.
The freshness watermark is derived from unresolved threads — resolving too early or too
late corrupts the "what's new" signal.

**Fix path:** make the code change → call `git.push { repository: REPO, ... }` →
call `resolve_thread { repository: REPO, threadId }`. Resolve only after the push
confirms. Never resolve before the fix is pushed.

**Discuss path:** call `reply_to_thread { repository: REPO, threadId, body }` with
your question or position. Leave the thread **UNRESOLVED**. Do not resolve until the
discussion concludes and the operator closes it.

**Ignore path:** call `resolve_thread { repository: REPO, threadId }` **only** after
explicit operator approval for that specific thread. Never auto-resolve an ignored
thread without confirmation.

### New comments during a session

If you call `get_review_round` again (e.g. to verify after a push) and
`openThreadCount` has increased or any thread shows `hasFreshComments: true` on a
previously-seen thread — stop. Present the new comments as a fresh triage before
continuing. Do not act on stale buckets.

## Wrap Up

After all approved actions are applied:

1. Report what was fixed, discussed, and left open.
2. If any threads remain open, list them.
3. State the current `openThreadCount` from the last `get_review_round` response.
4. **Do not decide merge readiness.** Report the evidence (open thread count, whether
   all fixes are pushed) and hand the MergeReady decision to the operator. The operator
   uses `mark_merge_ready` and `merge_pr` — these are not agent actions.
