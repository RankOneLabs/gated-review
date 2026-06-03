# Agent Workflow

This guide describes how an autonomous coding agent should use the gated-review
MCP server during a pull request review loop.

The server provides primitives. Triage judgment, round boundaries, MergeReady,
and merge decisions remain human-owned.

## Agent Tool Surface

Agent-facing tools:

- `open_pr`
- `git.push`
- `git.pull`
- `git.fetch`
- `get_review_round`
- `pr_status`
- `reply_to_thread`
- `resolve_thread`
- `request_next_round`

Operator-only tools are intentionally unavailable to the agent:

- `request_copilot_review`
- `mark_merge_ready`
- `merge_pr`

The agent must not try to recreate those operations through another GitHub
surface.

## Opening A PR

1. Make local changes with normal local git commands.
2. Commit locally.
3. Push through `git.push` so remote credentials stay behind the server.
4. Open the pull request with `open_pr`.

Local-only git operations such as staging, committing, branching, merging, and
rebasing stay in the shell. Remote git operations such as push, pull, and fetch
go through the MCP server.

## Review Rounds

A round starts only when the operator invokes triage. Incoming comments,
webhooks, and check updates do not let the agent start triage or mutate GitHub
on its own.

During triage, the triage skill calls `get_review_round` to read the current
unresolved review threads. The agent may inspect `pr_status` for advisory
context, but `pr_status` is not a gate.

The agent should wait for operator-approved triage outcomes before applying
review-thread mutations.

## Applying Approved Outcomes

After the operator approves triage:

- `fix`: make the code change locally, commit it, push with `git.push`, then
  call `resolve_thread` for the fixed thread when the fix is actually present.
- `discuss`: call `reply_to_thread` with the approved response.
- `ignore`: call `resolve_thread` only when the operator approved ignoring that
  thread.

The agent should not infer new `fix`, `discuss`, or `ignore` outcomes after
approval. If new comments arrive or the approved plan no longer fits the code,
stop and ask for another operator decision.

## Requesting Another Round

After a fix push, the agent may call `request_next_round` when the policy for
the repository wants an explicit CodeRabbit re-review command.

`request_next_round` is optional and policy-driven. The agent should not call it
when the operator or repository policy expects reviewers to run automatically.

## MergeReady And Merge

The agent never calls `mark_merge_ready` or `merge_pr`.

`MergeReady` is an operator assertion recorded by the GitHub `merge-ready`
label. `merge_pr` is operator-only and refuses to merge unless that label is
present.

If the agent believes the pull request is ready, it should report the evidence:

- open thread count from `pr_status`
- check summary from `pr_status`
- remaining approved outcomes, if any
- whether another review round was requested or still expected

The operator decides whether to mark MergeReady.

## Round Limits

Round limits, such as a `maxReviewRounds` value of `3`, are orchestrator policy.
They are advisory and do not let the agent bypass triage, mark MergeReady, or
merge.

When the orchestrator says the round limit has been reached, the agent should
surface the current `get_review_round` and `pr_status` evidence and wait for the
operator's MergeReady or continue-fixing decision.
