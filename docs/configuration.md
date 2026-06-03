# Configuration

This server starts from typed GitHub App configuration and fails fast if any required value is missing or invalid.

## Required Variables

- `GITHUB_APP_ID`: GitHub App identifier.
- `GITHUB_APP_INSTALLATION_ID`: installation identifier for the repository you want the server to operate on.
- `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`: the App private key in PEM form.
- `GITHUB_REPOSITORY`: repository scope in `owner/name` form when you want to pin the server to a specific repo.

## Optional Variables

- `GITHUB_API_BASE_URL`: defaults to `https://api.github.com`.
- `GITHUB_GRAPHQL_URL`: defaults to `https://api.github.com/graphql`.
- `GITHUB_COPILOT_REVIEWER_LOGIN`: reviewer login used by `request_copilot_review`, defaults to `copilot[bot]`.

## Private Key Format

- Inline keys may contain escaped newlines. The loader normalizes `\n` sequences into real line breaks.
- Path-based keys are read as UTF-8 text from the referenced file.

## Repository Scope

- If `GITHUB_REPOSITORY` is set, the server uses it directly.
- If it is omitted, startup derives the repository scope from the current git checkout's `origin` remote.
- The installation token must have access to the target repository.

## Startup Contract

- Build first with `bun run build`.
- Start the stdio server with `bun run start`.
- The process reads configuration once at startup and rejects invalid configuration before serving tools.
