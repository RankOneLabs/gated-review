import { err, ok, type Result } from '#root/src/result.js';
import { githubRequestFailedError, type ToolDomainError } from '#root/src/errors.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { tagEntity } from '#root/src/tools/read-model/entity.js';
import {
  reviewRoundSummariesQuery,
  reviewRoundThreadsQuery,
  reviewThreadCommentsQuery,
  type GraphQLReviewCommentNode,
  type GraphQLReviewRoundIssueCommentNode,
  type GraphQLReviewRoundSummariesQueryData,
  type GraphQLReviewRoundThreadsQueryData,
  type GraphQLReviewThreadCommentsQueryData
} from '#root/src/tools/read-model/graphql-queries.js';
import type {
  ReadModelReviewThread,
  ReadModelSummaryComment,
  ReadModelThreadComment,
  ReviewRound
} from '#root/src/tools/read-model/types.js';

export type GetReviewRoundInput = {
  pullRequestNumber: number;
  includeResolved?: boolean;
};

const operationName = 'get_review_round';
const graphqlRequestLabel = 'POST /graphql';

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
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLReviewRoundThreadsQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLReviewRoundThreadsQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: reviewRoundThreadsQuery,
    variables: {
      owner: context.repository.owner,
      repo: context.repository.repo,
      number: pullRequestNumber,
      after
    }
  });

  if (!response.ok) {
    return err(githubRequestFailedError(operationName, response.error.message));
  }

  return ok(response.value);
}

async function loadThreadCommentsBatch(
  context: ToolExecutionContext,
  threadIds: ReadonlyArray<string>
): Promise<Result<ReadonlyArray<ReadModelThreadComment[]>, ToolDomainError>> {
  const results = await Promise.all(threadIds.map((threadId) => loadThreadComments(context, threadId)));

  const comments: Array<ReadModelThreadComment[]> = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }

    comments.push(result.value);
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
    return err(githubRequestFailedError(operationName, response.error.message));
  }

  return ok(response.value);
}

async function requestSummaryCommentsPage(
  context: ToolExecutionContext,
  pullRequestNumber: number,
  after: string | null
): Promise<Result<GraphQLReviewRoundSummariesQueryData, ToolDomainError>> {
  const response = await context.github.graphql.request<GraphQLReviewRoundSummariesQueryData>({
    operationName,
    requestLabel: graphqlRequestLabel,
    query: reviewRoundSummariesQuery,
    variables: {
      owner: context.repository.owner,
      repo: context.repository.repo,
      number: pullRequestNumber,
      after
    }
  });

  if (!response.ok) {
    return err(githubRequestFailedError(operationName, response.error.message));
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
  pullRequestNumber: number
): Promise<Result<ReadModelSummaryComment[], ToolDomainError>> {
  const summaries: Array<ReadModelSummaryComment> = [];
  let after: string | null = null;

  while (true) {
    const page = await requestSummaryCommentsPage(context, pullRequestNumber, after);
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

export async function getReviewRound(
  input: GetReviewRoundInput,
  context: ToolExecutionContext
): Promise<Result<ReviewRound, ToolDomainError>> {
  const threads: Array<{
    id: string;
    state: 'open' | 'resolved';
    path: string | null;
    line: number | null;
  }> = [];
  let openThreadCount = 0;
  let after: string | null = null;

  while (true) {
    const page = await requestReviewThreadsPage(context, input.pullRequestNumber, after);
    if (!page.ok) {
      return page;
    }

    const pullRequest = page.value.repository?.pullRequest;
    if (!pullRequest) {
      return err(
        githubRequestFailedError(operationName, `Pull request #${input.pullRequestNumber} was not found.`)
      );
    }

    for (const thread of pullRequest.reviewThreads.nodes) {
      if (!thread.isResolved) {
        openThreadCount += 1;
      }

      if (thread.isResolved && !input.includeResolved) {
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
        githubRequestFailedError(operationName, `Pull request #${input.pullRequestNumber} returned a missing cursor.`)
      );
    }

    after = pullRequest.reviewThreads.pageInfo.endCursor;
  }

  const comments = await loadThreadCommentsBatch(
    context,
    threads.map((thread) => thread.id)
  );
  if (!comments.ok) {
    return comments;
  }

  const summaries = await loadSummaryComments(context, input.pullRequestNumber);
  if (!summaries.ok) {
    return summaries;
  }

  return ok({
    pullRequestNumber: input.pullRequestNumber,
    includeResolved: input.includeResolved ?? false,
    openThreadCount,
    threads: threads.map((thread, index) => ({
      ...thread,
      comments: comments.value[index]
    })),
    summaries: summaries.value
  });
}
