# GitHub App Permissions

This server uses an installation token. Grant the smallest set of permissions that still covers the tools you plan to expose.

## Installation Requirement

> **The GitHub App must be installed on every repository the server will operate on.**

This server is multi-repo: agents supply `repository` on each tool call. All requests use the single installation token configured via `GITHUB_APP_INSTALLATION_ID` — there is no per-repository token minting at call time. The repositories accessible to that installation determine what the server can reach; calls targeting a repository outside the installation's scope fail with an authorization error.

Install the App on each repository you intend to target, or use an organization-wide installation. Note that organization-wide installations only cover all repositories when configured for **All repositories**; installations scoped to **Selected repositories** cover only the explicitly listed repos.

## Minimal Recommended Set

- `Pull requests: read and write`
  - Required for opening pull requests, requesting reviews, and merging pull requests.
- `Issues: read and write`
  - Required for issue comments and label management.
- `Contents: read and write`
  - Required for git push, pull, and fetch operations that run through the installation token.
- `Commit statuses: read`
  - Required for reading the combined status state surfaced by `pr_status`.
- `Metadata: read`
  - Required for repository introspection.

## Label Creation Note

- `mark_merge_ready` can create the `merge-ready` label if it is missing.
- If you pre-provision that label, you can usually avoid the broader repository administration permission.
- If you want the server to create labels itself through the chosen API path, grant repository administration only for that flow.
