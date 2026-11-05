import { err, ok, type Result } from '#root/src/result.js';
import { createGitHubError, type GitHubError } from '#root/src/github/errors.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';
import { readGitHubErrorMessage } from '#root/src/github/response-error.js';
import { resolveGitHubUrl } from '#root/src/github/url.js';
import type {
  GitHubWorkflowJobLog,
  GitHubWorkflowJobsResponse,
  GitHubWorkflowRunsResponse,
  WorkflowJobId,
  WorkflowRunId
} from '#root/src/github/workflows.js';

export type GitHubRestMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type GitHubRepositoryScope = Readonly<{
  owner: string;
  repo: string;
}>;

export type GitHubRestRequest<TResponse> = Readonly<{
  operationName: string;
  requestLabel: string;
  method: GitHubRestMethod;
  path: string;
  body?: unknown;
  /** Repository whose owner selects the App installation; falls back to the fixed id when absent. */
  repository?: GitHubRepositoryScope;
  signal?: AbortSignal;
}>;

export type GitHubWorkflowRunsRequest = Readonly<{
  repository: GitHubRepositoryScope;
  headSha: string;
  page: number;
}>;

export type GitHubWorkflowJobsRequest = Readonly<{
  repository: GitHubRepositoryScope;
  runId: WorkflowRunId;
  attempt: number;
  page: number;
}>;

export type GitHubWorkflowJobLogRequest = Readonly<{
  repository: GitHubRepositoryScope;
  jobId: WorkflowJobId;
  maxCharacters: number;
}>;

export type InstallationIdResolver = (
  owner: string,
  repo: string
) => Promise<Result<number, GitHubError>>;

export type GitHubRestClientOptions = Readonly<{
  baseUrl: string;
  installationId?: number;
  resolveInstallationId?: InstallationIdResolver;
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
  return resolveGitHubUrl(baseUrl, path);
}

function buildRepositoryPath(repository: GitHubRepositoryScope, suffix: string) {
  return `/repos/${repository.owner}/${repository.repo}/${suffix}`;
}

export function createGitHubRestClient(
  options: GitHubRestClientOptions,
  dependencies: GitHubRestClientDependencies = {}
) {
  const fetchFn: GitHubFetch = dependencies.fetch ?? globalThis.fetch;

  async function resolveInstallationId(
    repository?: GitHubRepositoryScope
  ): Promise<Result<number, GitHubError>> {
    if (repository !== undefined && options.resolveInstallationId !== undefined) {
      return options.resolveInstallationId(repository.owner, repository.repo);
    }
    if (options.installationId !== undefined) {
      return ok(options.installationId);
    }
    return err(
      createGitHubError({
        category: 'configuration',
        operation: 'resolve_installation',
        requestLabel: 'installation routing',
        message: 'No installation routing configured: set an installation resolver or a fixed installation id.'
      })
    );
  }

  async function requestResponse(
    input: GitHubRestRequest<unknown>,
    redirect: RequestInit['redirect'] = 'follow'
  ): Promise<Result<Response, GitHubError>> {
    const installationId = await resolveInstallationId(input.repository);
    if (!installationId.ok) {
      return err(installationId.error);
    }

    const token = await options.tokenProvider.getInstallationToken(installationId.value);
    if (!token.ok) {
      return err(token.error);
    }

    let response: Response;
    try {
      response = await fetchFn(buildUrl(options.baseUrl, input.path), {
        method: input.method,
        redirect,
        signal: input.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.value}`,
          'Content-Type': 'application/json',
          'User-Agent': 'gated-review',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body)
      });
    } catch {
      return err(
        createGitHubError({
          category: 'transport',
          operation: input.operationName,
          requestLabel: input.requestLabel,
          message: 'GitHub REST request failed.'
        })
      );
    }

    if (!response.ok && !(redirect === 'manual' && response.status === 302)) {
      return err(
        createGitHubError({
          category: 'rest',
          operation: input.operationName,
          requestLabel: input.requestLabel,
          status: response.status,
            message: await readGitHubErrorMessage(response)
        })
      );
    }

    return ok(response);
  }

  async function request<TResponse>(input: GitHubRestRequest<TResponse>): Promise<Result<TResponse, GitHubError>> {
    const result = await requestResponse(input);
    if (!result.ok) return result;
    const response = result.value;

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

  async function getWorkflowJobLogs(input: GitHubWorkflowJobLogRequest): Promise<Result<GitHubWorkflowJobLog, GitHubError>> {
    const path = buildRepositoryPath(input.repository, `actions/jobs/${input.jobId}/logs`);
    if (!Number.isSafeInteger(input.maxCharacters) || input.maxCharacters <= 0) {
      return err(createGitHubError({
        category: 'configuration', operation: 'get_workflow_job_logs', requestLabel: `GET ${path}`,
        message: 'The workflow log character limit must be a positive integer.'
      }));
    }
    const signal = AbortSignal.timeout(15_000);
    const result = await requestResponse({
      operationName: 'get_workflow_job_logs',
      requestLabel: `GET ${path}`,
      method: 'GET',
      path,
      repository: input.repository,
      signal
    }, 'manual');
    if (!result.ok) return result;

    let response = result.value;
    try {
      if (response.status === 302) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (location === null) {
          return err(createGitHubError({
            category: 'rest', operation: 'get_workflow_job_logs', requestLabel: `GET ${path}`,
            message: `Job ${input.jobId} log redirect did not provide a download URL.`
          }));
        }
        const downloadUrl = new URL(location);
        if (downloadUrl.protocol !== 'https:' || downloadUrl.username !== '' || downloadUrl.password !== '') {
          return err(createGitHubError({
            category: 'rest', operation: 'get_workflow_job_logs', requestLabel: `GET ${path}`,
            message: `Job ${input.jobId} returned an invalid log download URL.`
          }));
        }
        // The signed download URL needs no GitHub token. Never forward credentials.
        response = await fetchFn(downloadUrl, { redirect: 'error', signal });
      }
      if (!response.ok) {
        await response.body?.cancel();
        return err(createGitHubError({
          category: 'rest', operation: 'get_workflow_job_logs', requestLabel: `GET ${path}`,
          status: response.status, message: `Job ${input.jobId} logs could not be downloaded.`
        }));
      }

      const reader = response.body?.getReader();
      if (reader === undefined) return ok({ text: '', truncated: false });
      const decoder = new TextDecoder();
      let text = '';
      let totalCharacters = 0;
      while (true) {
        const chunk = await reader.read();
        const decoded = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        totalCharacters += decoded.length;
        text = (text + decoded).slice(-input.maxCharacters);
        if (chunk.done) break;
      }
      return ok({ text, truncated: totalCharacters > input.maxCharacters });
    } catch {
      return err(createGitHubError({
        category: 'transport', operation: 'get_workflow_job_logs', requestLabel: `GET ${path}`,
        message: `Job ${input.jobId} log download failed or timed out.`
      }));
    }
  }

  return {
    request,
    getWorkflowJobLogs,
    listWorkflowRuns(input: GitHubWorkflowRunsRequest) {
      const params = new URLSearchParams({ head_sha: input.headSha, per_page: '100', page: String(input.page) });
      const path = buildRepositoryPath(input.repository, `actions/runs?${params}`);
      return request<GitHubWorkflowRunsResponse>({
        operationName: 'list_workflow_runs', requestLabel: `GET ${path}`,
        method: 'GET', path, repository: input.repository
      });
    },
    listWorkflowJobs(input: GitHubWorkflowJobsRequest) {
      const params = new URLSearchParams({ per_page: '100', page: String(input.page) });
      const path = buildRepositoryPath(input.repository, `actions/runs/${input.runId}/attempts/${input.attempt}/jobs?${params}`);
      return request<GitHubWorkflowJobsResponse>({
        operationName: 'list_workflow_jobs', requestLabel: `GET ${path}`,
        method: 'GET', path, repository: input.repository
      });
    },
    createPullRequest(repository: GitHubRepositoryScope, input: GitHubPullRequestInput) {
      return request<GitHubPullRequestResponse>({
        operationName: 'create_pull_request',
        requestLabel: `POST ${buildRepositoryPath(repository, 'pulls')}`,
        method: 'POST',
        path: buildRepositoryPath(repository, 'pulls'),
        repository,
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
    createIssueComment(repository: GitHubRepositoryScope, issueNumber: number, body: string) {
      return request<GitHubIssueCommentResponse>({
        operationName: 'create_issue_comment',
        requestLabel: `POST ${buildRepositoryPath(repository, `issues/${issueNumber}/comments`)}`,
        method: 'POST',
        path: buildRepositoryPath(repository, `issues/${issueNumber}/comments`),
        repository,
        body: { body }
      });
    },
    requestPullRequestReviewers(
      repository: GitHubRepositoryScope,
      pullRequestNumber: number,
      reviewers: ReadonlyArray<string> = [],
      teamReviewers: ReadonlyArray<string> = []
    ) {
      return request<GitHubRequestedReviewersResponse>({
        operationName: 'request_pull_request_reviewers',
        requestLabel: `POST ${buildRepositoryPath(repository, `pulls/${pullRequestNumber}/requested_reviewers`)}`,
        method: 'POST',
        path: buildRepositoryPath(repository, `pulls/${pullRequestNumber}/requested_reviewers`),
        repository,
        body: {
          ...(reviewers.length === 0 ? {} : { reviewers }),
          ...(teamReviewers.length === 0 ? {} : { team_reviewers: teamReviewers })
        }
      });
    },
    addIssueLabels(repository: GitHubRepositoryScope, issueNumber: number, labels: ReadonlyArray<string>) {
      return request<GitHubLabelsResponse>({
        operationName: 'add_issue_labels',
        requestLabel: `POST ${buildRepositoryPath(repository, `issues/${issueNumber}/labels`)}`,
        method: 'POST',
        path: buildRepositoryPath(repository, `issues/${issueNumber}/labels`),
        repository,
        body: { labels }
      });
    },
    getCommitCombinedStatus(repository: GitHubRepositoryScope, commitSha: string) {
      return request<GitHubCombinedStatusResponse>({
        operationName: 'get_commit_combined_status',
        requestLabel: `GET ${buildRepositoryPath(repository, `commits/${commitSha}/status`)}`,
        method: 'GET',
        path: buildRepositoryPath(repository, `commits/${commitSha}/status`),
        repository
      });
    },
    mergePullRequest(
      repository: GitHubRepositoryScope,
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
        requestLabel: `PUT ${buildRepositoryPath(repository, `pulls/${pullRequestNumber}/merge`)}`,
        method: 'PUT',
        path: buildRepositoryPath(repository, `pulls/${pullRequestNumber}/merge`),
        repository,
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
