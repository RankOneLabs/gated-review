import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { err, ok, type Result } from '#root/src/result.js';
import type { GitHubRepositoryScope } from '#root/src/github/rest.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';

const execFile = promisify(execFileCallback);

export type RepositoryResolutionError =
  | {
      kind: 'missing_repository_configuration';
      operation: 'resolve_repository_scope';
      detail: string;
    }
  | {
      kind: 'invalid_repository_configuration';
      operation: 'resolve_repository_scope';
      detail: string;
    }
  | {
      kind: 'repository_lookup_failed';
      operation: 'resolve_repository_scope';
      detail: string;
    };

function parseRepositorySlug(value: string): Result<GitHubRepositoryScope, RepositoryResolutionError> {
  const trimmed = value.trim();
  if (trimmed === '') {
    return err({
      kind: 'invalid_repository_configuration',
      operation: 'resolve_repository_scope',
      detail: 'GITHUB_REPOSITORY must not be empty.'
    });
  }

  const segments = trimmed.split('/');
  if (segments.length !== 2 || segments[0].trim() === '' || segments[1].trim() === '') {
    return err({
      kind: 'invalid_repository_configuration',
      operation: 'resolve_repository_scope',
      detail: 'GITHUB_REPOSITORY must be in owner/name form.'
    });
  }

  return ok({
    owner: segments[0],
    repo: segments[1]
  });
}

function parseGitHubRemoteUrl(remoteUrl: string): Result<GitHubRepositoryScope, RepositoryResolutionError> {
  const normalized = remoteUrl.trim().replace(/\.git$/, '');
  if (normalized === '') {
    return err({
      kind: 'invalid_repository_configuration',
      operation: 'resolve_repository_scope',
      detail: 'Git remote URL was empty.'
    });
  }

  let pathname = '';
  if (normalized.startsWith('git@')) {
    const match = normalized.match(/^git@[^:]+:(.+)$/);
    if (match === null) {
      return err({
        kind: 'invalid_repository_configuration',
        operation: 'resolve_repository_scope',
        detail: `Unable to parse Git remote URL: ${remoteUrl}`
      });
    }

    pathname = match[1] ?? '';
  } else {
    try {
      pathname = new URL(normalized).pathname;
    } catch {
      return err({
        kind: 'invalid_repository_configuration',
        operation: 'resolve_repository_scope',
        detail: `Unable to parse Git remote URL: ${remoteUrl}`
      });
    }
  }

  const segments = pathname.split('/').filter((segment) => segment.trim() !== '');
  if (segments.length < 2) {
    return err({
      kind: 'invalid_repository_configuration',
      operation: 'resolve_repository_scope',
      detail: `Unable to derive owner/name from Git remote URL: ${remoteUrl}`
    });
  }

  return ok({
    owner: segments[0] ?? '',
    repo: segments[1] ?? ''
  });
}

export async function resolveRepositoryScope(): Promise<
  Result<GitHubRepositoryScope, RepositoryResolutionError>
> {
  const configuredRepository = process.env.GITHUB_REPOSITORY;
  if (configuredRepository !== undefined) {
    return parseRepositorySlug(configuredRepository);
  }

  try {
    const remote = await execFile('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8'
    });
    return parseGitHubRemoteUrl(remote.stdout);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err({
      kind: 'repository_lookup_failed',
      operation: 'resolve_repository_scope',
      detail: `Unable to determine repository scope from git metadata: ${detail}`
    });
  }
}

export function resolveRepositoryScopeFromContext(context: ToolExecutionContext): GitHubRepositoryScope {
  return context.repository;
}
