import { err, ok, type Result } from '#root/src/result.js';
import { githubRequestFailedError, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { getReviewRoundInputSchema } from '#root/src/tools/schemas.js';
import { parseRepoSlug, type RepositoryRef } from '#root/src/tools/repository-ref.js';
import { tagEntity } from '#root/src/tools/read-model/entity.js';
import { makeRepoPrKey } from '#root/src/tools/freshness-store.js';
import {
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery,
  type GraphQLPrState,
  type GraphQLReviewCommentNode,
  type GraphQLReviewRoundIssueCommentNode,
  type GraphQLReviewRoundSummariesQueryData,
  type GraphQLReviewRoundThreadsQueryData,
  type GraphQLReviewThreadCommentsQueryData
} from '#root/src/tools/read-model/graphql-queries.js';
import type {
  ReadModelSummaryComment,
  ReadModelThreadComment,
  ReviewRound
} from '#root/src/tools/read-model/types.js';

const operationName = 'get_review_round';
const graphqlRequestLabel = 'POST /graphql';

function mapGitHubError(error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubRequestFailedError(
    operationName,
    `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`
  );
}

function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function toThreadComment(comment: GraphQLReviewCommentNode): ReadModelThreadComment | null {
  if (!comment.author || !isPresent(comment.author.login)) {
    return null;
  }

  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    author: tagEntity(comment.author.login)
  };
}

function toSummaryComment(
  comment: GraphQLReviewRoundIssueCommentNode
): ReadModelSummaryComment | null {
  if (!comment.author || !isPresent(comment.author.login)) {
    return null;
  }

  const author = tagEntity(comment.author.login);
  if (author.kind !== 'coderabbit' && author.kind !== 'copilot') {
    return null;
  }

  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    author
  };
}

async function requestReviewThreadsPage(
  context: ToolExecutionContext,
  repository: RepositoryRef,
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLReviewRoundThreadsQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLReviewRoundThreadsQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: reviewRoundThreadsQuery,
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

async function loadThreadCommentsBatched(
  context: ToolExecutionContext,
  threadIds: ReadonlyArray<string>,
  batchSize = 4
): Promise<Result<ReadonlyArray<ReadModelThreadComment[]>, ToolDomainError>> {
  const comments: Array<ReadModelThreadComment[]> = [];

  for (let index = 0; index < threadIds.length; index += batchSize) {
    const batch = threadIds.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((threadId) => loadThreadComments(context, threadId)));

    for (const result of batchResults) {
      if (!result.ok) {
        return result;
      }

      comments.push(result.value);
    }
  }

  return ok(comments);
}

async function requestThreadCommentsPage(
  context: ToolExecutionContext,
  threadId: string,
  after: string | null
): Promise<Result<GraphQLReviewThreadCommentsQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLReviewThreadCommentsQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: reviewThreadCommentsQuery,
    variables: {
      id: threadId,
      after
    }
  });

  if (!response.ok) {
    return err(mapGitHubError(response.error));
  }

  return ok(response.value);
}

async function requestSummaryCommentsPage(
  context: ToolExecutionContext,
  repository: RepositoryRef,
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLReviewRoundSummariesQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLReviewRoundSummariesQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: reviewRoundSummariesQuery,
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

async function loadThreadComments(
  context: ToolExecutionContext,
  threadId: string
): Promise<Result<ReadModelThreadComment[], ToolDomainError>> {
  const comments: Array<ReadModelThreadComment> = [];
  let after: string | null = null;

  while (true) {
    const page = await requestThreadCommentsPage(context, threadId, after);
    if (!page.ok) {
      return page;
    }

    const thread = page.value.node;
    if (!thread) {
      return err(githubRequestFailedError(operationName, `Review thread ${threadId} was not found.`));
    }

    for (const comment of thread.comments.nodes) {
      const normalized = toThreadComment(comment);
      if (normalized) {
        comments.push(normalized);
      }
    }

    if (!thread.comments.pageInfo.hasNextPage) {
      break;
    }

    if (!thread.comments.pageInfo.endCursor) {
      return err(
        githubRequestFailedError(operationName, `Review thread ${threadId} returned a missing cursor.`)
      );
    }

    after = thread.comments.pageInfo.endCursor;
  }

  return ok(comments);
}

async function loadSummaryComments(
  context: ToolExecutionContext,
  repository: RepositoryRef,
  pullRequestNumber: number
): Promise<Result<ReadModelSummaryComment[], ToolDomainError>> {
  const summaries: Array<ReadModelSummaryComment> = [];
  let after: string | null = null;

  while (true) {
    const page = await requestSummaryCommentsPage(context, repository, pullRequestNumber, after);
    if (!page.ok) {
      return page;
    }

    const pullRequest = page.value.repository?.pullRequest;
    if (!pullRequest) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${pullRequestNumber} was not found.`)
      );
    }

    for (const comment of pullRequest.comments.nodes) {
      const normalized = toSummaryComment(comment);
      if (normalized) {
        summaries.push(normalized);
      }
    }

    if (!pullRequest.comments.pageInfo.hasNextPage) {
      break;
    }

    if (!pullRequest.comments.pageInfo.endCursor) {
      return err(
        githubRequestFailedError(
          operationName,
          `Pull request #${pullRequestNumber} returned a missing summary cursor.`
        )
      );
    }

    after = pullRequest.comments.pageInfo.endCursor;
  }

  return ok(summaries);
}

function isThreadFresh(comments: ReadModelThreadComment[], prior: string | null): boolean {
  if (prior === null) return true;
  const priorMs = Date.parse(prior);
  return comments.some((c) => Date.parse(c.createdAt) > priorMs);
}

export async function getReviewRound(
  input: unknown,
  context: ToolExecutionContext
): Promise<Result<ReviewRound, ToolDomainError>> {
  const parsed = getReviewRoundInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(validationRejectedError(operationName, parsed.error.message));
  }

  const parsedInput = parsed.data;
  const repoRef = parseRepoSlug(parsedInput.repository);
  if (!repoRef.ok) {
    return err(validationRejectedError(operationName, repoRef.error.detail));
  }

  const threads: Array<{
    id: string;
    state: 'open' | 'resolved';
    path: string | null;
    line: number | null;
  }> = [];
  let openThreadCount = 0;
  let prState: GraphQLPrState | null = null;
  let after: string | null = null;

  while (true) {
    const page = await requestReviewThreadsPage(context, repoRef.value, parsedInput.pullRequestNumber, after);
    if (!page.ok) {
      return page;
    }

    const pullRequest = page.value.repository?.pullRequest;
    if (!pullRequest) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${parsedInput.pullRequestNumber} was not found.`)
      );
    }

    if (prState === null) {
      prState = pullRequest.state;
    }

    for (const thread of pullRequest.reviewThreads.nodes) {
      if (!thread.isResolved) {
        openThreadCount += 1;
      }

      if (thread.isResolved && !parsedInput.includeResolved) {
        continue;
      }

      threads.push({
        id: thread.id,
        state: thread.isResolved ? 'resolved' : 'open',
        path: thread.path,
        line: thread.line,
      });
    }

    if (!pullRequest.reviewThreads.pageInfo.hasNextPage) {
      break;
    }

    if (!pullRequest.reviewThreads.pageInfo.endCursor) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${parsedInput.pullRequestNumber} returned a missing cursor.`)
      );
    }

    after = pullRequest.reviewThreads.pageInfo.endCursor;
  }

  const comments = await loadThreadCommentsBatched(
    context,
    threads.map((thread) => thread.id)
  );
  if (!comments.ok) {
    return comments;
  }

  const summaries = await loadSummaryComments(context, repoRef.value, parsedInput.pullRequestNumber);
  if (!summaries.ok) {
    return summaries;
  }

  const key = makeRepoPrKey(repoRef.value, parsedInput.pullRequestNumber);
  const prior = context.freshness?.lastDeliveredAt(key) ?? null;

  let maxCreatedAt: string | null = null;
  let maxCreatedAtMs = -Infinity;
  for (const threadComments of comments.value) {
    for (const comment of threadComments) {
      const ms = Date.parse(comment.createdAt);
      if (ms > maxCreatedAtMs) {
        maxCreatedAtMs = ms;
        maxCreatedAt = comment.createdAt;
      }
    }
  }

  if (maxCreatedAt !== null && context.freshness) {
    context.freshness.record(key, maxCreatedAt);
  }

  if ((prState === 'CLOSED' || prState === 'MERGED') && context.freshness) {
    context.freshness.purge(key);
  }

  return ok({
    pullRequestNumber: parsedInput.pullRequestNumber,
    includeResolved: parsedInput.includeResolved ?? false,
    openThreadCount,
    freshSince: prior,
    threads: threads.map((thread, index) => {
      const threadComments = comments.value[index];
      const hasFreshComments =
        thread.state === 'resolved' ? false : isThreadFresh(threadComments, prior);
      return {
        ...thread,
        hasFreshComments,
        comments: threadComments
      };
    }),
    summaries: summaries.value
  });
}
