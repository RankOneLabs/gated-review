import type { Brand } from '#root/src/domain.js';
import { err, ok, type Result } from '#root/src/result.js';

export type RepoSlug = Brand<'RepoSlug'>;
export type RepoPrKey = Brand<'RepoPrKey'>;

export type RepositoryRef = Readonly<{
  owner: string;
  repo: string;
}>;

export type RepositoryRefError = {
  kind: 'invalid_repository_slug';
  operation: 'parse_repo_slug';
  detail: string;
};

export function parseRepoSlug(input: string): Result<RepositoryRef, RepositoryRefError> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return err({
      kind: 'invalid_repository_slug',
      operation: 'parse_repo_slug',
      detail: 'Repository slug must not be empty.'
    });
  }

  const segments = trimmed.split('/');
  if (segments.length !== 2 || segments[0].trim() === '' || segments[1].trim() === '') {
    return err({
      kind: 'invalid_repository_slug',
      operation: 'parse_repo_slug',
      detail: 'Repository slug must be in owner/name form.'
    });
  }

  return ok({
    owner: segments[0].trim(),
    repo: segments[1].trim()
  });
}

export function makeRepoPrKey(ref: RepositoryRef, prNumber: number): RepoPrKey {
  return `${ref.owner}/${ref.repo}#${prNumber}` as RepoPrKey;
}
