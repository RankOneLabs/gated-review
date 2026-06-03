# Local Development

## Prerequisites

- Bun 1.3 or newer.
- Git available on `PATH`.

## Install

```bash
bun install
```

## Test

- `bun run typecheck`
- `bun run test:contracts`
- `bun run test:integration`
- `bun run test`

## Build And Start

```bash
bun run build
bun run start
```

`bun run start` launches the stdio MCP server from `dist/src/index.js`, so the build step is required first.

## Environment

Set the same GitHub App variables used in deployment:

```bash
export GITHUB_APP_ID=123456
export GITHUB_APP_INSTALLATION_ID=987654
export GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
export GITHUB_REPOSITORY=openai/gated-review
```

Optional variables:

- `GITHUB_API_BASE_URL`
- `GITHUB_GRAPHQL_URL`
- `GITHUB_COPILOT_REVIEWER_LOGIN`

## Notes

- The git gateway tests use local bare remotes and a stubbed token provider, so you can validate the git flow without contacting GitHub.
- The server exposes shaped outputs only; tool outputs must parse against the published schemas.
- Operator-only tools are not exposed to agent-facing views.
