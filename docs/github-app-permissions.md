# GitHub App Permissions

This server uses an installation token. Grant the smallest set of permissions that still covers the tools you plan to expose.

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

## Installation Scope

- Install the GitHub App on every repository the server should manage.
- The installation token is repository-scoped; it is not a general-purpose PAT replacement.
