import { err, ok, type Result } from '#root/src/result.js';
import { githubRequestFailedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { prStatusLabelsQuery, type GraphQLPrStatusLabelsQueryData } from '#root/src/tools/read-model/graphql-queries.js';

export const mergeReadyLabel = 'merge-ready';
export const mergeReadyLabelColor = 'c2e0c6';
export const mergeReadyLabelDescription = 'Ready to merge.';
export const mergeReadyLabelNotFoundDetail = `GitHub label ${mergeReadyLabel} was not found on the repository.`;

type GitHubLabelResponse = Readonly<{
  id: number;
  name: string;
  color: string;
  description?: string | null;
}>;

function mapGitHubError(error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubRequestFailedError(
    'merge_ready',
    `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`
  );
}

async function requestMergeReadyPage(
  context: ToolExecutionContext,
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLPrStatusLabelsQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLPrStatusLabelsQueryData>({
    operationName: 'merge_ready',
    requestLabel: 'POST /graphql',
    query: prStatusLabelsQuery,
    variables: {
      owner: context.repository.owner,
      repo: context.repository.repo,
      number: pullRequestNumber,
      after
    }
  });

  if (!response.ok) {
    return err(mapGitHubError(response.error));
  }

  return ok(response.value);
}

export async function loadMergeReadyState(
  context: ToolExecutionContext,
  pullRequestNumber: number
): Promise<Result<boolean, ToolDomainError>> {
  let after: string | null = null;

  while (true) {
    const page = await requestMergeReadyPage(context, pullRequestNumber, after);
    if (!page.ok) {
      return page;
    }

    const pullRequest = page.value.repository?.pullRequest;
    if (!pullRequest) {
      return err(
        githubRequestFailedError('merge_ready', `Pull request #${pullRequestNumber} was not found.`)
      );
    }

    if (pullRequest.labels.nodes.some((label) => label.name.toLowerCase() === mergeReadyLabel)) {
      return ok(true);
    }

    if (!pullRequest.labels.pageInfo.hasNextPage) {
      return ok(false);
    }

    if (!pullRequest.labels.pageInfo.endCursor) {
      return err(
        githubRequestFailedError(
          'merge_ready',
          `Pull request #${pullRequestNumber} returned a missing label cursor.`
        )
      );
    }

    after = pullRequest.labels.pageInfo.endCursor;
  }
}

async function getMergeReadyLabel(
  context: ToolExecutionContext
): Promise<Result<GitHubLabelResponse, ToolDomainError>> {
  const response = await context.github.rest.request<GitHubLabelResponse>({
    operationName: 'mark_merge_ready',
    requestLabel: `GET /repos/${context.repository.owner}/${context.repository.repo}/labels/${mergeReadyLabel}`,
    method: 'GET',
    path: `/repos/${context.repository.owner}/${context.repository.repo}/labels/${mergeReadyLabel}`
  });

  if (!response.ok) {
    if (response.error.status === 404) {
      return err(
        githubRequestFailedError('mark_merge_ready', mergeReadyLabelNotFoundDetail)
      );
    }

    return err(mapGitHubError(response.error));
  }

  return ok(response.value);
}

async function createMergeReadyLabel(
  context: ToolExecutionContext
): Promise<Result<GitHubLabelResponse, ToolDomainError>> {
  const response = await context.github.rest.request<GitHubLabelResponse>({
    operationName: 'mark_merge_ready',
    requestLabel: `POST /repos/${context.repository.owner}/${context.repository.repo}/labels`,
    method: 'POST',
    path: `/repos/${context.repository.owner}/${context.repository.repo}/labels`,
    body: {
      name: mergeReadyLabel,
      color: mergeReadyLabelColor,
      description: mergeReadyLabelDescription
    }
  });

  if (!response.ok) {
    return err(mapGitHubError(response.error));
  }

  return ok(response.value);
}

export async function ensureMergeReadyLabel(
  context: ToolExecutionContext
): Promise<Result<GitHubLabelResponse, ToolDomainError>> {
  const existing = await getMergeReadyLabel(context);
  if (existing.ok) {
    return existing;
  }

  if (
    existing.error.operation === 'mark_merge_ready' &&
    existing.error.kind === 'github_request_failed' &&
    existing.error.detail === mergeReadyLabelNotFoundDetail
  ) {
    return createMergeReadyLabel(context);
  }

  return existing;
}

export async function addMergeReadyLabel(
  context: ToolExecutionContext,
  pullRequestNumber: number
): Promise<Result<void, ToolDomainError>> {
  const ensured = await ensureMergeReadyLabel(context);
  if (!ensured.ok) {
    return ensured;
  }

  const response = await context.github.rest.addIssueLabels(
    context.repository,
    pullRequestNumber,
    [mergeReadyLabel]
  );
  if (!response.ok) {
    return err(mapGitHubError(response.error));
  }

  return ok(undefined);
}

export async function removeMergeReadyLabel(
  context: ToolExecutionContext,
  pullRequestNumber: number
): Promise<Result<void, ToolDomainError>> {
  const currentState = await loadMergeReadyState(context, pullRequestNumber);
  if (!currentState.ok) {
    return currentState;
  }

  if (!currentState.value) {
    return ok(undefined);
  }

  const response = await context.github.rest.request<unknown>({
    operationName: 'mark_merge_ready',
    requestLabel: `DELETE /repos/${context.repository.owner}/${context.repository.repo}/issues/${pullRequestNumber}/labels/${mergeReadyLabel}`,
    method: 'DELETE',
    path: `/repos/${context.repository.owner}/${context.repository.repo}/issues/${pullRequestNumber}/labels/${mergeReadyLabel}`
  });

  if (!response.ok) {
    if (response.error.status === 404) {
      return ok(undefined);
    }

    return err(mapGitHubError(response.error));
  }

  return ok(undefined);
}
