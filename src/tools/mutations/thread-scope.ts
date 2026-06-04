import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubGraphQLClient } from '#root/src/github/graphql.js';
import { err, ok, type Result } from '#root/src/result.js';
import { mapGitHubError } from '#root/src/tools/mutations/errors.js';
import { fetchReviewThreadRepository } from '#root/src/tools/mutations/graphql-mutations.js';
import type { RepositoryRef } from '#root/src/tools/repository-ref.js';

/**
 * Confirms that `threadId` actually belongs to `repoRef` before a mutation is
 * applied. The GitHub mutations key only off the thread node id, so without this
 * preflight a caller could pass any `repository` slug and still mutate a thread
 * in a different repo (subject only to token access). We fail closed: a missing
 * thread, a thread with no resolvable repository, or a repository mismatch all
 * reject as validation errors rather than proceeding.
 */
export async function enforceThreadRepository(
  client: GitHubGraphQLClient,
  operation: string,
  threadId: string,
  repoRef: RepositoryRef
): Promise<Result<true, ToolDomainError>> {
  const requestedRepository = `${repoRef.owner}/${repoRef.repo}`;

  const lookup = await fetchReviewThreadRepository(client, {
    threadId,
    repository: { owner: repoRef.owner, repo: repoRef.repo }
  });
  if (!lookup.ok) {
    const error = mapGitHubError(operation, lookup.error);
    console.warn('[gated-review] thread scope lookup failed', {
      operation,
      threadId,
      requestedRepository,
      detail: error.detail
    });
    return err(error);
  }

  const nameWithOwner = lookup.value.node?.pullRequest?.repository.nameWithOwner;
  if (nameWithOwner === undefined) {
    console.warn('[gated-review] thread scope rejected', {
      operation,
      threadId,
      requestedRepository,
      detail: 'thread not found or not a pull request review thread'
    });
    return err(
      validationRejectedError(
        operation,
        `Review thread ${threadId} was not found or is not a pull request review thread.`
      )
    );
  }

  if (nameWithOwner.toLowerCase() !== requestedRepository.toLowerCase()) {
    console.warn('[gated-review] thread scope rejected', {
      operation,
      threadId,
      requestedRepository,
      resolvedRepository: nameWithOwner,
      detail: 'repository mismatch'
    });
    return err(
      validationRejectedError(
        operation,
        `Review thread ${threadId} belongs to ${nameWithOwner}, not the requested repository ${requestedRepository}.`
      )
    );
  }

  console.info('[gated-review] thread scope verified', {
    operation,
    threadId,
    requestedRepository,
    resolvedRepository: nameWithOwner
  });
  return ok(true);
}
