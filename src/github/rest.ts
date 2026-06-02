import { err, ok, type Result } from '#root/src/result.js';
import { createGitHubError, type GitHubError } from '#root/src/github/errors.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';

export type GitHubRestMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type GitHubRestRequest<TResponse> = Readonly<{
  operationName: string;
  requestLabel: string;
  method: GitHubRestMethod;
  path: string;
  body?: unknown;
}>;

export type GitHubRestClientOptions = Readonly<{
  baseUrl: string;
  installationId: number;
  tokenProvider: GitHubInstallationTokenProvider;
}>;

export type GitHubRestClientDependencies = Readonly<{
  fetch?: GitHubFetch;
}>;

export type GitHubPullRequestInput = Readonly<{
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
}>;

export type GitHubPullRequestResponse = Readonly<{
  number: number;
  html_url: string;
  state: string;
  draft?: boolean;
}>;

export type GitHubIssueCommentResponse = Readonly<{
  id: number;
  body: string;
  html_url: string;
}>;

export type GitHubRequestedReviewersResponse = Readonly<{
  number: number;
  requested_reviewers: ReadonlyArray<Readonly<{ login: string }>>;
  requested_teams: ReadonlyArray<Readonly<{ name: string }>>;
}>;

export type GitHubLabelsResponse = ReadonlyArray<Readonly<{ id: number; name: string; color: string }>>;

export type GitHubCombinedStatusResponse = Readonly<{
  state: string;
  statuses: ReadonlyArray<Readonly<{ state: string; context: string }>>;
}>;

export type GitHubMergeResponse = Readonly<{
  merged: boolean;
  sha: string;
  message: string;
}>;

function buildUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl);
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim() !== '') {
        return message;
      }
    }
  } catch {
    // Fall through to the HTTP status text.
  }

  return response.statusText || 'GitHub rejected the request.';
}

export function createGitHubRestClient(
  options: GitHubRestClientOptions,
  dependencies: GitHubRestClientDependencies = {}
) {
  const fetchFn: GitHubFetch = dependencies.fetch ?? globalThis.fetch;

  async function request<TResponse>(input: GitHubRestRequest<TResponse>): Promise<Result<TResponse, GitHubError>> {
    const token = await options.tokenProvider.getInstallationToken(options.installationId);
    if (!token.ok) {
      return err(token.error);
    }

    const response = await fetchFn(buildUrl(options.baseUrl, input.path), {
      method: input.method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.value}`,
        'Content-Type': 'application/json',
        'User-Agent': 'gated-review',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });

    if (!response.ok) {
      return err(
        createGitHubError({
          category: 'rest',
          operation: input.operationName,
          requestLabel: input.requestLabel,
          status: response.status,
          message: await readErrorMessage(response)
        })
      );
    }

    if (response.status === 204) {
      return ok(undefined as TResponse);
    }

    try {
      const body = (await response.json()) as TResponse;
      return ok(body);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return err(
        createGitHubError({
          category: 'rest',
          operation: input.operationName,
          requestLabel: input.requestLabel,
          status: response.status,
          message: `GitHub returned invalid JSON: ${detail}`
        })
      );
    }
  }

  return {
    request,
    createPullRequest(input: GitHubPullRequestInput) {
      return request<GitHubPullRequestResponse>({
        operationName: 'create_pull_request',
        requestLabel: 'POST /repos/{owner}/{repo}/pulls',
        method: 'POST',
        path: '/repos/{owner}/{repo}/pulls',
        body: {
          title: input.title,
          head: input.head,
          base: input.base,
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.draft === undefined ? {} : { draft: input.draft }),
          ...(input.maintainerCanModify === undefined
            ? {}
            : { maintainer_can_modify: input.maintainerCanModify })
        }
      });
    },
    createIssueComment(issueNumber: number, body: string) {
      return request<GitHubIssueCommentResponse>({
        operationName: 'create_issue_comment',
        requestLabel: `POST /repos/{owner}/{repo}/issues/${issueNumber}/comments`,
        method: 'POST',
        path: `/repos/{owner}/{repo}/issues/${issueNumber}/comments`,
        body: { body }
      });
    },
    requestPullRequestReviewers(
      pullRequestNumber: number,
      reviewers: ReadonlyArray<string> = [],
      teamReviewers: ReadonlyArray<string> = []
    ) {
      return request<GitHubRequestedReviewersResponse>({
        operationName: 'request_pull_request_reviewers',
        requestLabel: `POST /repos/{owner}/{repo}/pulls/${pullRequestNumber}/requested_reviewers`,
        method: 'POST',
        path: `/repos/{owner}/{repo}/pulls/${pullRequestNumber}/requested_reviewers`,
        body: {
          ...(reviewers.length === 0 ? {} : { reviewers }),
          ...(teamReviewers.length === 0 ? {} : { team_reviewers: teamReviewers })
        }
      });
    },
    addIssueLabels(issueNumber: number, labels: ReadonlyArray<string>) {
      return request<GitHubLabelsResponse>({
        operationName: 'add_issue_labels',
        requestLabel: `POST /repos/{owner}/{repo}/issues/${issueNumber}/labels`,
        method: 'POST',
        path: `/repos/{owner}/{repo}/issues/${issueNumber}/labels`,
        body: { labels }
      });
    },
    getCommitCombinedStatus(commitSha: string) {
      return request<GitHubCombinedStatusResponse>({
        operationName: 'get_commit_combined_status',
        requestLabel: `GET /repos/{owner}/{repo}/commits/${commitSha}/status`,
        method: 'GET',
        path: `/repos/{owner}/{repo}/commits/${commitSha}/status`
      });
    },
    mergePullRequest(
      pullRequestNumber: number,
      input: Readonly<{
        mergeMethod?: 'merge' | 'squash' | 'rebase';
        commitTitle?: string;
        commitMessage?: string;
        sha?: string;
      }> = {}
    ) {
      return request<GitHubMergeResponse>({
        operationName: 'merge_pull_request',
        requestLabel: `PUT /repos/{owner}/{repo}/pulls/${pullRequestNumber}/merge`,
        method: 'PUT',
        path: `/repos/{owner}/{repo}/pulls/${pullRequestNumber}/merge`,
        body: {
          ...(input.mergeMethod === undefined ? {} : { merge_method: input.mergeMethod }),
          ...(input.commitTitle === undefined ? {} : { commit_title: input.commitTitle }),
          ...(input.commitMessage === undefined ? {} : { commit_message: input.commitMessage }),
          ...(input.sha === undefined ? {} : { sha: input.sha })
        }
      });
    }
  };
}
