import type { GitHubGraphQLClient } from '#root/src/github/graphql.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { Result } from '#root/src/result.js';

export type AddPullRequestReviewThreadReplyInput = Readonly<{
  threadId: string;
  body: string;
}>;

export type AddPullRequestReviewThreadReplyResponse = Readonly<{
  addPullRequestReviewThreadReply: Readonly<{
    comment: Readonly<{
      id: string;
    }>;
  }>;
}>;

export type ResolveReviewThreadInput = Readonly<{
  threadId: string;
}>;

export type ReviewThreadRepositoryInput = Readonly<{
  threadId: string;
}>;

export type ReviewThreadRepositoryResponse = Readonly<{
  node:
    | Readonly<{
        pullRequest: Readonly<{
          repository: Readonly<{
            nameWithOwner: string;
          }>;
        }> | null;
      }>
    | null;
}>;

export type ResolveReviewThreadResponse = Readonly<{
  resolveReviewThread: Readonly<{
    thread: Readonly<{
      id: string;
    }>;
  }>;
}>;

export function addPullRequestReviewThreadReply(
  client: GitHubGraphQLClient,
  input: AddPullRequestReviewThreadReplyInput
): Promise<Result<AddPullRequestReviewThreadReplyResponse, GitHubError>> {
  return client.request<AddPullRequestReviewThreadReplyResponse>({
    operationName: 'AddPullRequestReviewThreadReply',
    requestLabel: 'POST /graphql',
    query: `
      mutation AddPullRequestReviewThreadReply($threadId: ID!, $body: String!) {
        addPullRequestReviewThreadReply(
          input: { pullRequestReviewThreadId: $threadId, body: $body }
        ) {
          comment {
            id
          }
        }
      }
    `,
    variables: {
      threadId: input.threadId,
      body: input.body
    }
  });
}

export function fetchReviewThreadRepository(
  client: GitHubGraphQLClient,
  input: ReviewThreadRepositoryInput
): Promise<Result<ReviewThreadRepositoryResponse, GitHubError>> {
  return client.request<ReviewThreadRepositoryResponse>({
    operationName: 'ReviewThreadRepository',
    requestLabel: 'POST /graphql',
    query: `
      query ReviewThreadRepository($threadId: ID!) {
        node(id: $threadId) {
          ... on PullRequestReviewThread {
            pullRequest {
              repository {
                nameWithOwner
              }
            }
          }
        }
      }
    `,
    variables: {
      threadId: input.threadId
    }
  });
}

export function resolveReviewThread(
  client: GitHubGraphQLClient,
  input: ResolveReviewThreadInput
): Promise<Result<ResolveReviewThreadResponse, GitHubError>> {
  return client.request<ResolveReviewThreadResponse>({
    operationName: 'ResolveReviewThread',
    requestLabel: 'POST /graphql',
    query: `
      mutation ResolveReviewThread($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread {
            id
          }
        }
      }
    `,
    variables: {
      threadId: input.threadId
    }
  });
}
