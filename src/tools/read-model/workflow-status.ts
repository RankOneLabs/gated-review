import { z } from 'zod';

import { githubRequestFailedError, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import { createGitHubError, type GitHubError } from '#root/src/github/errors.js';
import {
  workflowConclusions,
  workflowStatuses,
  type GitHubWorkflowJob,
  type GitHubWorkflowRun,
  type WorkflowConclusion,
  type WorkflowJobId,
  type WorkflowRunId
} from '#root/src/github/workflows.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { parseRepoSlug, repositorySlugSchema, type RepositoryRef } from '#root/src/tools/repository-ref.js';
import { workflowTargetQuery, type GraphQLWorkflowTargetQueryData } from '#root/src/tools/read-model/graphql-queries.js';

const operationName = 'get_workflow_status';
const maxRunsPerCommit = 1_000; // GitHub's filtered workflow-run search limit.
const maxLogDownloads = 10;
const maxLogCharacters = 20_000;

// Apply nominal IDs at the type level, keeping the wire schemas plain numbers.
const workflowRunIdSchema = z.number().int().positive() as unknown as z.ZodType<WorkflowRunId, number>;
const workflowJobIdSchema = z.number().int().positive() as unknown as z.ZodType<WorkflowJobId, number>;

const workflowLogSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), text: z.string(), truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal('unavailable'), detail: z.string().min(1) }).strict()
]);

const failedWorkflowJobSchema = z.object({
  id: workflowJobIdSchema,
  name: z.string(),
  url: z.url(),
  status: z.enum(workflowStatuses),
  conclusion: z.enum(workflowConclusions).nullable(),
  logs: workflowLogSchema
}).strict();

const failedWorkflowJobsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), jobs: z.array(failedWorkflowJobSchema) }).strict(),
  z.object({ kind: z.literal('unavailable'), detail: z.string().min(1) }).strict()
]);

const workflowRunSchema = z.object({
  id: workflowRunIdSchema,
  name: z.string().nullable(),
  url: z.url(),
  headSha: z.string().min(1),
  event: z.string().min(1),
  status: z.enum(workflowStatuses),
  conclusion: z.enum(workflowConclusions).nullable(),
  attempt: z.number().int().positive(),
  failedJobs: failedWorkflowJobsSchema
}).strict();

export const workflowStatusInputSchema = z.object({
  repository: repositorySlugSchema,
  pullRequestNumber: z.number().int().positive()
}).strict().describe('get_workflow_status.input');

export const workflowStatusOutputSchema = z.object({
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  mergeSha: z.string().min(1).nullable(),
  runs: z.array(workflowRunSchema),
  truncated: z.boolean()
}).strict().describe('get_workflow_status.output');

export type WorkflowStatusOutput = z.infer<typeof workflowStatusOutputSchema>;
type WorkflowRun = z.infer<typeof workflowRunSchema>;
type FailedWorkflowJobs = z.infer<typeof failedWorkflowJobsSchema>;
type WorkflowLog = z.infer<typeof workflowLogSchema>;
type WorkflowRuns = Readonly<{ runs: ReadonlyArray<GitHubWorkflowRun>; truncated: boolean }>;
type WorkflowRunTarget = Readonly<{ repository: RepositoryRef; headSha: string; pullRequestNumber: number }>;
type WorkflowJobsTarget = Readonly<{ repository: RepositoryRef; run: GitHubWorkflowRun }>;
type WorkflowRunJobs = Readonly<{
  run: GitHubWorkflowRun;
  jobs: Result<ReadonlyArray<GitHubWorkflowJob>, GitHubError>;
}>;
type WorkflowJobLogEntry = Readonly<{ jobId: WorkflowJobId; logs: WorkflowLog }>;

function describeGitHubError(error: GitHubError): string {
  const status = error.status === undefined ? '' : ` status=${error.status}`;
  return `${error.operation}: ${error.message} (${error.requestLabel}${status})`;
}

function isFailedConclusion(conclusion: WorkflowConclusion | null): boolean {
  return conclusion !== null && conclusion !== 'success' && conclusion !== 'neutral' && conclusion !== 'skipped';
}

export function selectLatestWorkflowRuns(runs: ReadonlyArray<GitHubWorkflowRun>): ReadonlyArray<GitHubWorkflowRun> {
  const latest = new Map<string, GitHubWorkflowRun>();
  for (const run of runs) {
    // Push and pull_request executions are independent, as are branch and merge commits.
    const key = JSON.stringify([run.workflow_id, run.event, run.head_branch, run.head_sha]);
    const previous = latest.get(key);
    if (previous === undefined || run.run_number > previous.run_number ||
      (run.run_number === previous.run_number && run.run_attempt > previous.run_attempt)) {
      latest.set(key, run);
    }
  }
  return [...latest.values()].sort((left, right) => right.id - left.id);
}

async function loadWorkflowRuns(context: ToolExecutionContext, target: WorkflowRunTarget): Promise<Result<WorkflowRuns, GitHubError>> {
  const runs: GitHubWorkflowRun[] = [];
  let totalCount = 0;
  for (let page = 1; page <= maxRunsPerCommit / 100; page += 1) {
    const response = await context.github.rest.listWorkflowRuns({
      repository: target.repository, headSha: target.headSha, page
    });
    if (!response.ok) return response;
    totalCount = response.value.total_count;
    runs.push(...response.value.workflow_runs);
    if (runs.length >= totalCount) break;
    if (response.value.workflow_runs.length === 0) {
      return err(createGitHubError({
        category: 'rest', operation: operationName, requestLabel: 'list workflow runs',
        message: `PR #${target.pullRequestNumber} returned an incomplete workflow-run page for ${target.headSha}.`
      }));
    }
  }
  return ok({
    runs: runs.filter((run) => run.head_sha === target.headSha &&
      (run.pull_requests.length === 0 || run.pull_requests.some((pr) => pr.number === target.pullRequestNumber))),
    truncated: runs.length < totalCount || runs.length >= maxRunsPerCommit
  });
}

async function loadWorkflowJobs(
  context: ToolExecutionContext,
  target: WorkflowJobsTarget
): Promise<Result<ReadonlyArray<GitHubWorkflowJob>, GitHubError>> {
  const jobs: GitHubWorkflowJob[] = [];
  for (let page = 1; ; page += 1) {
    const response = await context.github.rest.listWorkflowJobs({
      repository: target.repository, runId: target.run.id, attempt: target.run.run_attempt, page
    });
    if (!response.ok) return response;
    jobs.push(...response.value.jobs);
    if (jobs.length >= response.value.total_count) return ok(jobs.filter((job) => isFailedConclusion(job.conclusion)));
    if (response.value.jobs.length === 0) {
      return err(createGitHubError({
        category: 'rest', operation: operationName, requestLabel: 'list workflow jobs',
        message: `Workflow run ${target.run.id} attempt ${target.run.run_attempt} returned an incomplete jobs page.`
      }));
    }
  }
}

function toWorkflowRun(entry: WorkflowRunJobs, logs: ReadonlyMap<WorkflowJobId, WorkflowLog>): WorkflowRun {
  const { run, jobs } = entry;
  const failedJobs: FailedWorkflowJobs = jobs.ok
    ? { kind: 'available', jobs: jobs.value.map((job) => ({
      id: job.id, name: job.name, url: job.html_url, status: job.status, conclusion: job.conclusion,
      logs: logs.get(job.id) ?? {
        kind: 'unavailable', detail: `Log download limit (${maxLogDownloads} jobs per response) reached; use the job URL to view its logs.`
      }
    })) }
    : { kind: 'unavailable', detail: describeGitHubError(jobs.error) };
  return {
    id: run.id, name: run.name, url: run.html_url, headSha: run.head_sha, event: run.event,
    status: run.status, conclusion: run.conclusion, attempt: run.run_attempt, failedJobs
  };
}

export async function getWorkflowStatus(input: unknown, context: ToolExecutionContext): Promise<Result<WorkflowStatusOutput, ToolDomainError>> {
  const parsed = workflowStatusInputSchema.safeParse(input);
  if (!parsed.success) return err(validationRejectedError(operationName, parsed.error.message));
  const repository = parseRepoSlug(parsed.data.repository);
  if (!repository.ok) return err(validationRejectedError(operationName, repository.error.detail));

  const target = await context.github.graphql.request<GraphQLWorkflowTargetQueryData>({
    operationName, requestLabel: 'POST /graphql', query: workflowTargetQuery,
    variables: { owner: repository.value.owner, repo: repository.value.repo, number: parsed.data.pullRequestNumber },
    repository: repository.value
  });
  if (!target.ok) return err(githubRequestFailedError(operationName, describeGitHubError(target.error)));
  const pullRequest = target.value.repository?.pullRequest;
  if (!pullRequest) return err(githubRequestFailedError(operationName, `Pull request #${parsed.data.pullRequestNumber} was not found.`));

  const mergeSha = pullRequest.potentialMergeCommit?.oid ?? null;
  const commitShas = [...new Set([pullRequest.headRefOid, ...(mergeSha === null ? [] : [mergeSha])])];
  const fetchedRuns: GitHubWorkflowRun[] = [];
  let truncated = false;
  for (const headSha of commitShas) {
    const response = await loadWorkflowRuns(context, { repository: repository.value, headSha, pullRequestNumber: parsed.data.pullRequestNumber });
    if (!response.ok) return err(githubRequestFailedError(operationName, describeGitHubError(response.error)));
    fetchedRuns.push(...response.value.runs);
    truncated ||= response.value.truncated;
  }

  const runJobs: WorkflowRunJobs[] = [];
  for (const run of selectLatestWorkflowRuns(fetchedRuns)) {
    const jobs = isFailedConclusion(run.conclusion) || run.status === 'in_progress'
      ? await loadWorkflowJobs(context, { repository: repository.value, run })
      : ok<ReadonlyArray<GitHubWorkflowJob>, GitHubError>([]);
    runJobs.push({ run, jobs });
  }

  const failedJobs = runJobs.flatMap((entry) => entry.jobs.ok ? entry.jobs.value : []);
  const selectedJobs = [...new Map(failedJobs.map((job) => [job.id, job])).values()].slice(0, maxLogDownloads);
  const logs = new Map<WorkflowJobId, WorkflowLog>();
  // Match the bounded concurrency used for review-thread comment reads. Ten slow
  // downloads take at most three 15-second batches rather than 150 seconds.
  const batchSize = 4;
  for (let index = 0; index < selectedJobs.length; index += batchSize) {
    const batch = await Promise.all(selectedJobs.slice(index, index + batchSize).map(async (job): Promise<WorkflowJobLogEntry> => {
      const downloaded = await context.github.rest.getWorkflowJobLogs({
        repository: repository.value, jobId: job.id, maxCharacters: maxLogCharacters
      });
      return {
        jobId: job.id,
        logs: downloaded.ok ? { kind: 'available', ...downloaded.value } : { kind: 'unavailable', detail: describeGitHubError(downloaded.error) }
      };
    }));
    for (const entry of batch) logs.set(entry.jobId, entry.logs);
  }
  const runs = runJobs.map((entry) => toWorkflowRun(entry, logs));
  const logDownloadCount = selectedJobs.length;

  console.info('[gated-review] workflow status fetched', {
    operation: operationName, repository: parsed.data.repository, pullRequestNumber: parsed.data.pullRequestNumber,
    headSha: pullRequest.headRefOid, mergeSha, runCount: runs.length, logDownloadCount, truncated,
    runs: runs.map((run) => ({ id: run.id, status: run.status, conclusion: run.conclusion, attempt: run.attempt })),
    unavailableJobLists: runs.flatMap((run) => run.failedJobs.kind === 'unavailable'
      ? [{ runId: run.id, detail: run.failedJobs.detail }] : []),
    unavailableLogs: runs.flatMap((run) => run.failedJobs.kind === 'available' ? run.failedJobs.jobs : [])
      .flatMap((job) => job.logs.kind === 'unavailable' ? [{ jobId: job.id, detail: job.logs.detail }] : [])
  });
  return ok({ pullRequestNumber: parsed.data.pullRequestNumber, headSha: pullRequest.headRefOid, mergeSha, runs, truncated });
}
