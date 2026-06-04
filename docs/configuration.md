# Configuration

The server reads all configuration from environment variables at startup and fails fast if any required value is missing or invalid.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | Yes | — | Numeric GitHub App identifier. |
| `GITHUB_APP_INSTALLATION_ID` | Yes | — | Numeric installation identifier. Must be the installation that covers every repository the server will operate on. |
| `GITHUB_APP_PRIVATE_KEY` | Yes* | — | App private key in PEM form, inline. Escaped `\n` sequences are normalized to real newlines. |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Yes* | — | Path to a PEM file containing the App private key. Read as UTF-8 at startup. |
| `GATED_REVIEW_HTTP_PORT` | Yes | — | Port the HTTP MCP server listens on (e.g. `3555`). Must be a positive integer ≤ 65535. |
| `GITHUB_API_BASE_URL` | No | `https://api.github.com` | Override for GitHub REST base URL (GitHub Enterprise). |
| `GITHUB_GRAPHQL_URL` | No | `https://api.github.com/graphql` | Override for GitHub GraphQL endpoint (GitHub Enterprise). |
| `GITHUB_COPILOT_REVIEWER_LOGIN` | No | `copilot[bot]` | Login used by `request_copilot_review`. |

\* Exactly one of `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH` is required.

## What Is Not Here

**No `GITHUB_REPOSITORY`.** The server is multi-repo: the repository is supplied by the agent on each tool call, not pinned at startup. The installation token must have access to every repository the agent targets.

**No `GATED_REVIEW_ACTOR`.** The MCP surface is agent-only; operator verbs are absent from it by construction, not by a runtime switch. There is no actor variable to set.

**No state-DB path.** Freshness state is held in memory for the lifetime of the process. It is not persisted to disk and requires no database or file path. See [docs/freshness-model.md](freshness-model.md) for the rationale.

## Private Key Format

- Inline keys may contain escaped newlines (`\n`). The loader normalizes them into real line breaks.
- Path-based keys are read as UTF-8 text from the referenced file.

## Startup Contract

The server checks all required variables before serving any requests. An invalid or missing variable causes the process to exit with an error message identifying the offending variable.

To run the server:

```sh
bun run build
bun run start        # starts the HTTP MCP server
```

See [docs/deployment.md](deployment.md) for Docker Compose deployment on willie.
