Bounded MCP server for agent-driven GitHub PR reviews, with enforced triage and merge gates.

## What It Ships

- Curated MCP tools for read-model inspection, review mutations, git gateway operations, and operator actions.
- Schema-shaped outputs that are validated at the registry boundary.
- Actor-scoped tool exposure with operator-only tools hidden from agent-facing views.
- No `github_raw` passthrough or uncurated GitHub escape hatch.

## Docs

- [Configuration](docs/configuration.md)
- [GitHub App permissions](docs/github-app-permissions.md)
- [Local development](docs/local-development.md)
- [Deferred items](docs/deferred-items.md)

## Build And Run

1. Set the required GitHub App environment variables.
2. Run `bun run build`.
3. Start the stdio server with `bun run start`.

## Verification

- `bun run typecheck`
- `bun test`
- `bun run test:contracts`
- `bun run test:integration`
