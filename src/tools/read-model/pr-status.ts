import { z } from 'zod';

import { err, ok, type Result } from '#root/src/result.js';
import { githubRequestFailedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { summarizeChecks } from '#root/src/tools/read-model/checks.js';
import { prStatusInputSchema } from '#root/src/tools/schemas.js';
import {
  prStatusQuery,
  type GraphQLPrStatusQueryData
} from '#root/src/tools/read-model/graphql-queries.js';
import type { PullRequestStatus } from '#root/src/tools/read-model/types.js';
import { loadMergeReadyState } from '#root/src/tools/operator/merge-ready.js';

export type PrStatusInput = {
  pullRequestNumber: number;
};

const operationName = 'pr_status';
const graphqlRequestLabel = 'POST /graphql';

function mapGitHubError(error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubRequestFailedError(
    operationName,
    `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`
  );
}

async function requestPrStatusPage(
  context: ToolExecutionContext,
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLPrStatusQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLPrStatusQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: prStatusQuery,
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

async function loadOpenThreadCount(
  context: ToolExecutionContext,
  pullRequestNumber: number
): Promise<Result<{ openThreadCount: number; headRefOid: string }, ToolDomainError>> {
  let after: string | null = null;
  let headRefOid: string | null = null;
  let openThreadCount = 0;

  while (true) {
    const page = await requestPrStatusPage(context, pullRequestNumber, after);
    if (!page.ok) {
      return page;
    }

    const pullRequest = page.value.repository?.pullRequest;
    if (!pullRequest) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${pullRequestNumber} was not found.`)
      );
    }

    headRefOid = headRefOid ?? pullRequest.headRefOid;

    for (const thread of pullRequest.reviewThreads.nodes) {
      if (!thread.isResolved) {
        openThreadCount += 1;
      }
    }

    if (!pullRequest.reviewThreads.pageInfo.hasNextPage) {
      break;
    }

    if (!pullRequest.reviewThreads.pageInfo.endCursor) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${pullRequestNumber} returned a missing cursor.`)
      );
    }

    after = pullRequest.reviewThreads.pageInfo.endCursor;
  }

  if (!headRefOid) {
    return err(githubRequestFailedError(operationName, `Pull request #${pullRequestNumber} was not found.`));
  }

  return ok({
    openThreadCount,
    headRefOid
  });
}

export async function getPrStatus(
  input: unknown,
  context: ToolExecutionContext
): Promise<Result<PullRequestStatus, ToolDomainError>> {
  const parsedInput = prStatusInputSchema.parse(input);

  const openThreads = await loadOpenThreadCount(context, parsedInput.pullRequestNumber);
  if (!openThreads.ok) {
    return openThreads;
  }

  const mergeReady = await loadMergeReadyState(context, parsedInput.pullRequestNumber);
  if (!mergeReady.ok) {
    return mergeReady;
  }

  const status = await context.github.rest.getCommitCombinedStatus(
    context.repository,
    openThreads.value.headRefOid
  );
  if (!status.ok) {
    return err(mapGitHubError(status.error));
  }

  return ok({
    pullRequestNumber: parsedInput.pullRequestNumber,
    openThreadCount: openThreads.value.openThreadCount,
    mergeReady: {
      isReady: mergeReady.value,
      source: 'github_label',
      label: 'merge-ready'
    },
    checks: summarizeChecks(status.value)
  });
}
