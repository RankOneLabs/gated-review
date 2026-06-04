# GitHub App Permissions

This server uses an installation token. Grant the smallest set of permissions that still covers the tools you plan to expose.

## Installation Requirement

> **The GitHub App must be installed on every repository the server will operate on.**

This server is multi-repo: agents supply `repository` on each tool call, and the server mints an installation token for that repository at call time. If the App is not installed on a target repository, the tool call fails with an authorization error. There is no partial-install fallback — the App installation is the access gate for every repository.

Install the App once per organization or per repository as your GitHub App settings allow. A single organization-wide installation covers all repositories in that organization automatically.

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
