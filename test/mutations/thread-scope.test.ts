import { describe, expect, it } from 'vitest';

import { err, ok, type Result } from '#root/src/result.js';
import { createGitHubError, type GitHubError } from '#root/src/github/errors.js';
import type { GitHubGraphQLClient } from '#root/src/github/graphql.js';
import { enforceThreadRepository } from '#root/src/tools/mutations/thread-scope.js';
import type { RepositoryRef } from '#root/src/tools/repository-ref.js';

const repoRef: RepositoryRef = { owner: 'openai', repo: 'gated-review' };

function clientReturning(result: Result<unknown, GitHubError>): GitHubGraphQLClient {
  return {
    async request() {
      return result as never;
    }
  };
}

describe('enforceThreadRepository', () => {
  it('accepts a thread that belongs to the requested repository (case-insensitive)', async () => {
    const client = clientReturning(
      ok({
        node: {
          pullRequest: {
            repository: { nameWithOwner: 'OpenAI/Gated-Review' }
          }
        }
      })
    );

    const result = await enforceThreadRepository(client, 'resolve_thread', 'thread-1', repoRef);

    expect(result).toEqual({ ok: true, value: true });
  });

  it('rejects a thread that belongs to a different repository', async () => {
    const client = clientReturning(
      ok({
        node: {
          pullRequest: {
            repository: { nameWithOwner: 'evil/other-repo' }
          }
        }
      })
    );

    const result = await enforceThreadRepository(client, 'resolve_thread', 'thread-1', repoRef);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_rejected');
      expect(result.error.operation).toBe('resolve_thread');
      expect(result.error.detail).toContain('evil/other-repo');
    }
  });

  it('rejects when the thread node is missing or is not a review thread', async () => {
    const client = clientReturning(ok({ node: null }));

    const result = await enforceThreadRepository(client, 'reply_to_thread', 'thread-1', repoRef);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_rejected');
      expect(result.error.detail).toContain('not found');
    }
  });

  it('maps an underlying GitHub error to a github_error', async () => {
    const client = clientReturning(
      err(
        createGitHubError({
          category: 'transport',
          operation: 'ReviewThreadRepository',
          requestLabel: 'POST /graphql',
          message: 'GitHub GraphQL request failed.'
        })
      )
    );

    const result = await enforceThreadRepository(client, 'resolve_thread', 'thread-1', repoRef);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('github_error');
    }
  });
});
