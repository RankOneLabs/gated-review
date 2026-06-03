# Guardrail Snippet for Consuming Repos

Copy the block below into your repo's `CLAUDE.md` (or your agent's system prompt) when
the gated-review MCP server is present. It enforces the hard boundaries at the
prompt level, complementing the physical gate on the tool surface.

---

```markdown
## Gated Review Environment

This environment has the gated-review MCP server connected. All PR and remote-git
operations must go through it.

**Never use:**
- `gh` (GitHub CLI) for any PR or API operation
- `git push`, `git pull`, or `git fetch` in the shell
- The GitHub API directly (REST or GraphQL)

**Always use instead:**
- `get_review_round` to read PR review threads and comments
- `reply_to_thread` to reply to a review thread
- `resolve_thread` to resolve a handled thread
- `git.push`, `git.pull`, `git.fetch` for all remote git operations

**Merging and merge-ready are human-only.** Do not call `merge_pr` or
`mark_merge_ready`. Do not decide merge readiness. Report the evidence
(open thread count, push status) and hand the decision to the operator.
```

---

## Notes

- Place this block early in `CLAUDE.md` so it loads before any task instructions.
- The MCP server's `actorScopes` already gates operator-only tools (`merge_pr`,
  `mark_merge_ready`, `request_copilot_review`) off the agent surface physically.
  The snippet reinforces the boundary in prose so the agent never attempts to
  work around it via shell or API.
- For repos without the gated-review MCP server, use the `ghreview` skill instead
  (raw GitHub CLI fetch, no MCP dependency).
