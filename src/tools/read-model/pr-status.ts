import { err, ok, type Result } from '#root/src/result.js';
import { githubRequestFailedError, toolEntity, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { summarizeChecks } from '#root/src/tools/read-model/checks.js';
import { prStatusInputSchema } from '#root/src/tools/schemas.js';
import { makeRepoPrKey } from '#root/src/tools/freshness-store.js';
import {
  prStatusQuery,
  type GraphQLPrState,
  type GraphQLPrStatusQueryData
} from '#root/src/tools/read-model/graphql-queries.js';
import type { PullRequestStatus } from '#root/src/tools/read-model/types.js';
import { loadMergeReadyState } from '#root/src/tools/operator/merge-ready.js';
import { parseRepoSlug, type RepositoryRef } from '#root/src/tools/repository-ref.js';

const operationName = 'pr_status';
const graphqlRequestLabel = 'POST /graphql';

function mapGitHubError(error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubRequestFailedError(
    operationName,
    `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`
  );
}

function remapToolError(error: ToolDomainError): ToolDomainError {
  return {
    ...error,
    operation: operationName,
    entity: toolEntity(operationName)
  };
}

async function requestPrStatusPage(
  context: ToolExecutionContext,
  repository: RepositoryRef,
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLPrStatusQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLPrStatusQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: prStatusQuery,
    variables: {
      owner: repository.owner,
      repo: repository.repo,
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
  repository: RepositoryRef,
  pullRequestNumber: number
): Promise<Result<{ openThreadCount: number; headRefOid: string; prState: GraphQLPrState }, ToolDomainError>> {
  let after: string | null = null;
  let headRefOid: string | null = null;
  let prState: GraphQLPrState | null = null;
  let openThreadCount = 0;

  while (true) {
    const page = await requestPrStatusPage(context, repository, pullRequestNumber, after);
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
    prState = prState ?? pullRequest.state;

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
    headRefOid,
    prState: prState ?? 'OPEN'
  });
}

export async function getPrStatus(
  input: unknown,
  context: ToolExecutionContext
): Promise<Result<PullRequestStatus, ToolDomainError>> {
  const parsed = prStatusInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(validationRejectedError(operationName, parsed.error.message));
  }

  const parsedInput = parsed.data;
  const repoRef = parseRepoSlug(parsedInput.repository);
  if (!repoRef.ok) {
    return err(validationRejectedError(operationName, repoRef.error.detail));
  }

  const openThreads = await loadOpenThreadCount(context, repoRef.value, parsedInput.pullRequestNumber);
  if (!openThreads.ok) {
    return openThreads;
  }

  const freshness = context.freshness;
  const isTerminalState =
    openThreads.value.prState === 'CLOSED' || openThreads.value.prState === 'MERGED';

  const mergeReady = await loadMergeReadyState(context, repoRef.value, parsedInput.pullRequestNumber);
  if (!mergeReady.ok) {
    return err(remapToolError(mergeReady.error));
  }

  const status = await context.github.rest.getCommitCombinedStatus(
    repoRef.value,
    openThreads.value.headRefOid
  );
  if (!status.ok) {
    return err(mapGitHubError(status.error));
  }

  // Purge only after the downstream reads succeed, so a transient read failure
  // can't delete the watermark and re-open stale delivery on the next round.
  if (freshness !== undefined && isTerminalState) {
    const key = makeRepoPrKey(repoRef.value, parsedInput.pullRequestNumber);
    freshness.purge(key);
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
