import type { GitHubGraphQLClient } from '#root/src/github/graphql.js';
import type { GitHubRepositoryScope } from '#root/src/github/rest.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { Result } from '#root/src/result.js';

export type AddPullRequestReviewThreadReplyInput = Readonly<{
  threadId: string;
  body: string;
  repository?: GitHubRepositoryScope;
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
  repository?: GitHubRepositoryScope;
}>;

export type ReviewThreadRepositoryInput = Readonly<{
  threadId: string;
  repository?: GitHubRepositoryScope;
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
    },
    repository: input.repository
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
    },
    repository: input.repository
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
    },
    repository: input.repository
  });
}

export type PullRequestDraftStateInput = Readonly<{
  owner: string;
  repo: string;
  number: number;
}>;

export type PullRequestDraftState = Readonly<{
  id: string;
  number: number;
  url: string;
  isDraft: boolean;
}>;

export type PullRequestDraftStateResponse = Readonly<{
  repository: Readonly<{
    pullRequest: PullRequestDraftState | null;
  }> | null;
}>;

export type PullRequestDraftMutationInput = Readonly<{
  pullRequestId: string;
  repository?: GitHubRepositoryScope;
}>;

export type MarkPullRequestReadyForReviewResponse = Readonly<{
  markPullRequestReadyForReview: Readonly<{
    pullRequest: Omit<PullRequestDraftState, 'id'>;
  }>;
}>;

export type ConvertPullRequestToDraftResponse = Readonly<{
  convertPullRequestToDraft: Readonly<{
    pullRequest: Omit<PullRequestDraftState, 'id'>;
  }>;
}>;

export function fetchPullRequestDraftState(
  client: GitHubGraphQLClient,
  input: PullRequestDraftStateInput
): Promise<Result<PullRequestDraftStateResponse, GitHubError>> {
  return client.request<PullRequestDraftStateResponse>({
    operationName: 'PullRequestDraftState',
    requestLabel: 'POST /graphql',
    query: `
      query PullRequestDraftState($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            id
            number
            url
            isDraft
          }
        }
      }
    `,
    variables: {
      owner: input.owner,
      repo: input.repo,
      number: input.number
    },
    repository: { owner: input.owner, repo: input.repo }
  });
}

export function markPullRequestReadyForReview(
  client: GitHubGraphQLClient,
  input: PullRequestDraftMutationInput
): Promise<Result<MarkPullRequestReadyForReviewResponse, GitHubError>> {
  return client.request<MarkPullRequestReadyForReviewResponse>({
    operationName: 'MarkPullRequestReadyForReview',
    requestLabel: 'POST /graphql',
    query: `
      mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            number
            url
            isDraft
          }
        }
      }
    `,
    variables: {
      pullRequestId: input.pullRequestId
    },
    repository: input.repository
  });
}

export function convertPullRequestToDraft(
  client: GitHubGraphQLClient,
  input: PullRequestDraftMutationInput
): Promise<Result<ConvertPullRequestToDraftResponse, GitHubError>> {
  return client.request<ConvertPullRequestToDraftResponse>({
    operationName: 'ConvertPullRequestToDraft',
    requestLabel: 'POST /graphql',
    query: `
      mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
        convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            number
            url
            isDraft
          }
        }
      }
    `,
    variables: {
      pullRequestId: input.pullRequestId
    },
    repository: input.repository
  });
}
