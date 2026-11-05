// GitHub Actions REST contracts:
// https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository
// https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt
export type WorkflowId = number & { readonly __brand: 'WorkflowId' };
export type WorkflowRunId = number & { readonly __brand: 'WorkflowRunId' };
export type WorkflowJobId = number & { readonly __brand: 'WorkflowJobId' };

export const workflowStatuses = ['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'] as const;
export const workflowConclusions = [
  'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'
] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];
export type WorkflowConclusion = (typeof workflowConclusions)[number];

export type GitHubWorkflowRun = Readonly<{
  id: WorkflowRunId;
  workflow_id: WorkflowId;
  name: string | null;
  html_url: string;
  head_sha: string;
  head_branch: string | null;
  event: string;
  status: WorkflowStatus;
  conclusion: WorkflowConclusion | null;
  run_number: number;
  run_attempt: number;
  pull_requests: ReadonlyArray<Readonly<{ number: number }>>;
}>;

export type GitHubWorkflowRunsResponse = Readonly<{
  total_count: number;
  workflow_runs: ReadonlyArray<GitHubWorkflowRun>;
}>;

export type GitHubWorkflowJob = Readonly<{
  id: WorkflowJobId;
  name: string;
  html_url: string;
  status: WorkflowStatus;
  conclusion: WorkflowConclusion | null;
}>;

export type GitHubWorkflowJobsResponse = Readonly<{
  total_count: number;
  jobs: ReadonlyArray<GitHubWorkflowJob>;
}>;

export type GitHubWorkflowJobLog = Readonly<{
  text: string;
  truncated: boolean;
}>;
