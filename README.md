Bounded MCP server for agent-driven GitHub PR reviews across multiple repositories, with enforced triage and merge gates.

The server runs as a long-lived HTTP service (Streamable HTTP MCP transport). Agents connect to a single endpoint and supply the target repository on each tool call — no per-repository server instances, no stdio sessions.

## What It Ships

- Curated MCP tools for read-model inspection, review mutations, git gateway operations, and operator actions.
- Schema-shaped outputs that are validated at the registry boundary.
- Actor-scoped tool exposure: operator-only tools are absent from the agent-facing surface by construction, not by a runtime flag.
- Per-PR freshness watermarks held in memory for the server lifetime.
- No `github_raw` passthrough or uncurated GitHub escape hatch.

## Docs

- [Agent workflow](docs/agent-workflow.md)
- [Configuration](docs/configuration.md)
- [Deployment](docs/deployment.md)
- [Freshness model](docs/freshness-model.md)
- [GitHub App permissions](docs/github-app-permissions.md)
- [Local development](docs/local-development.md)
- [Review policy](docs/review-policy.md)
- [Deferred items](docs/deferred-items.md)

## Build And Run

1. Set the required environment variables — see [docs/configuration.md](docs/configuration.md).
2. Run `bun run build`.
3. Start the HTTP server with `bun run start` (`GATED_REVIEW_HTTP_PORT` controls the port).

For Docker Compose deployment on willie, see [docs/deployment.md](docs/deployment.md).

## Verification

- `bun run typecheck`
- `bun run test`
- `bun run test:contracts`
- `bun run test:integration`
