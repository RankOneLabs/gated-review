# Skills

This document describes the agent skills shipped with the gated-review server and when
to prefer each one.

## gated-pr-review

**Precondition:** The gated-review MCP server must be reachable.

**When to use:** Use `gated-pr-review` whenever the MCP server is connected. It routes
every PR and remote-git operation through the server — fetch, mutation, and push — so
credentials never leave the server and the full resolve-discipline is enforced.

**Arguments:** `<owner/repo> <pr-number>` (e.g. `acme/my-service 42`)

**Installation:** Copy `skills/gated-pr-review/SKILL.md` from this repo into your
agent skills directory (e.g. `~/.claude/skills/gated-pr-review/SKILL.md`). Add the
guardrail snippet from `docs/guardrail-snippet.md` to your repo's `CLAUDE.md`.

See `skills/gated-pr-review/SKILL.md` for the full fetch → bucket → present → act
loop specification.

## ghreview (fallback)

**Precondition:** No gated-review MCP server. Uses `gh` CLI directly.

**When to use:** Use `ghreview` only for repos that do not have the gated-review MCP
server connected. It fetches via `gh api` and `gh pr view`, so it works anywhere `gh`
is authenticated — but it provides no server-side credential routing, no freshness
watermark, and no physical gate on operator-only actions.

`ghreview` is the raw-GitHub fallback. If the MCP server is present, always prefer
`gated-pr-review`.

## Selecting the right skill

| Situation | Use |
|---|---|
| gated-review MCP server is connected | `gated-pr-review` |
| No MCP server; `gh` is authenticated | `ghreview` |

The description field of each skill names its precondition, so an agent reading the
skill list can select the correct one without additional instruction.
