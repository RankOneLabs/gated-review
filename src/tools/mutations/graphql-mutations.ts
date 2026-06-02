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
    operationName: 'add_pull_request_review_thread_reply',
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

export function resolveReviewThread(
  client: GitHubGraphQLClient,
  input: ResolveReviewThreadInput
): Promise<Result<ResolveReviewThreadResponse, GitHubError>> {
  return client.request<ResolveReviewThreadResponse>({
    operationName: 'resolve_review_thread',
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
