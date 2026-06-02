import { err, ok, type Result } from '#root/src/result.js';
import { githubRequestFailedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { prStatusLabelsQuery, type GraphQLPrStatusLabelsQueryData } from '#root/src/tools/read-model/graphql-queries.js';

export const mergeReadyLabel = 'merge-ready';
export const mergeReadyLabelColor = 'c2e0c6';
export const mergeReadyLabelDescription = 'Ready to merge.';

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
