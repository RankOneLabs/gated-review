import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';
import type { GitHubWorkflowJob, GitHubWorkflowRun, WorkflowId, WorkflowJobId, WorkflowRunId } from '#root/src/github/workflows.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import { getWorkflowStatus, workflowStatusOutputSchema } from '#root/src/tools/read-model/workflow-status.js';

const input = { repository: 'acme/demo', pullRequestNumber: 42 };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeRun(overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun {
  return {
    id: 1 as WorkflowRunId, workflow_id: 1 as WorkflowId, name: 'CI', html_url: 'https://github.com/acme/demo/actions/runs/1',
    head_sha: 'head-sha', head_branch: 'feature', event: 'pull_request', status: 'completed', conclusion: 'failure',
    run_number: 1, run_attempt: 1, pull_requests: [{ number: 42 }], ...overrides
  };
}

function makeJob(overrides: Partial<GitHubWorkflowJob> = {}): GitHubWorkflowJob {
  return {
    id: 10 as WorkflowJobId, name: 'tests', html_url: 'https://github.com/acme/demo/actions/runs/1/job/10',
    status: 'completed', conclusion: 'failure', ...overrides
  };
}

function createContext(fetch: GitHubFetch, mergeSha: string | null = null): ToolExecutionContext {
  const tokenProvider = { async getInstallationToken() { return ok('installation-token'); } };
  return {
    github: {
      apiBaseUrl: 'https://api.github.com', graphqlUrl: 'https://api.github.com/graphql',
      rest: createGitHubRestClient({ baseUrl: 'https://api.github.com', installationId: 99, tokenProvider }, { fetch }),
      graphql: createGitHubGraphQLClient({ graphqlUrl: 'https://api.github.com/graphql', installationId: 99, tokenProvider }, {
        fetch: async () => jsonResponse({ data: { repository: { pullRequest: {
          headRefOid: 'head-sha', potentialMergeCommit: mergeSha === null ? null : { oid: mergeSha }
        } } } })
      })
    },
    copilotReviewerLogin: 'copilot[bot]'
  };
}

describe('workflow status integration', () => {
  it('exposes its own tool and returns current statuses plus failed-job log text', async () => {
    const fetch = vi.fn<GitHubFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/actions/runs')) return jsonResponse({ total_count: 5, workflow_runs: [
        makeRun({ id: 1 as WorkflowRunId, run_number: 1 }),
        makeRun({ id: 2 as WorkflowRunId, run_number: 2, conclusion: 'success' }),
        makeRun({ id: 3 as WorkflowRunId, workflow_id: 2 as WorkflowId, run_attempt: 2 }),
        makeRun({ id: 4 as WorkflowRunId, workflow_id: 3 as WorkflowId, status: 'in_progress', conclusion: null }),
        makeRun({ id: 5 as WorkflowRunId, workflow_id: 4 as WorkflowId, status: 'queued', conclusion: null })
      ] });
      if (url.pathname.endsWith('/runs/3/attempts/2/jobs')) return jsonResponse({ total_count: 2, jobs: [
        makeJob(), makeJob({ id: 11 as WorkflowJobId, conclusion: 'success' })
      ] });
      if (url.pathname.endsWith('/runs/4/attempts/1/jobs')) return jsonResponse({ total_count: 0, jobs: [] });
      if (url.pathname.endsWith('/jobs/10/logs')) return new Response('AssertionError: expected 2, received 1');
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const tool = createToolRegistry(createContext(fetch)).find((tool) => tool.name === 'get_workflow_status');
    if (tool === undefined) throw new Error('Workflow tool missing');

    const result = await tool.handler(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = workflowStatusOutputSchema.parse(result.value);
      expect(output.runs.map((run) => ({ id: run.id, status: run.status, conclusion: run.conclusion }))).toEqual([
        { id: 5, status: 'queued', conclusion: null },
        { id: 4, status: 'in_progress', conclusion: null },
        { id: 3, status: 'completed', conclusion: 'failure' },
        { id: 2, status: 'completed', conclusion: 'success' }
      ]);
      expect(output.runs.find((run) => run.id === 3)?.failedJobs).toEqual({ kind: 'available', jobs: [{
        id: 10, name: 'tests', url: 'https://github.com/acme/demo/actions/runs/1/job/10', status: 'completed', conclusion: 'failure',
        logs: { kind: 'available', text: 'AssertionError: expected 2, received 1', truncated: false }
      }] });
      expect(output.truncated).toBe(false);
    }
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/logs'))).toHaveLength(1);
  });

  it('paginates both workflow runs and jobs without losing failures after the first 100', async () => {
    const runs = Array.from({ length: 101 }, (_, index) => makeRun({
      id: (index + 1) as WorkflowRunId, workflow_id: (index + 1) as WorkflowId,
      conclusion: index === 100 ? 'failure' : 'success'
    }));
    const jobs = Array.from({ length: 101 }, (_, index) => makeJob({
      id: (index + 1) as WorkflowJobId, conclusion: index === 100 ? 'timed_out' : 'success'
    }));
    const fetch = vi.fn<GitHubFetch>(async (input) => {
      const url = new URL(String(input));
      const offset = (Number(url.searchParams.get('page') ?? 1) - 1) * 100;
      if (url.pathname.endsWith('/actions/runs')) return jsonResponse({ total_count: runs.length, workflow_runs: runs.slice(offset, offset + 100) });
      if (url.pathname.endsWith('/jobs')) return jsonResponse({ total_count: jobs.length, jobs: jobs.slice(offset, offset + 100) });
      if (url.pathname.endsWith('/logs')) return new Response('job timed out');
      throw new Error(`Unexpected request: ${url.pathname}`);
    });

    const result = await getWorkflowStatus(input, createContext(fetch));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runs).toHaveLength(101);
      expect(result.value.runs[0].failedJobs).toMatchObject({ kind: 'available', jobs: [{ id: 101, conclusion: 'timed_out', logs: { text: 'job timed out' } }] });
    }
    expect(fetch.mock.calls.filter(([url]) => new URL(String(url)).searchParams.get('page') === '2')).toHaveLength(2);
  });

  it('includes test-merge runs and independent events, while excluding other PRs and commits', async () => {
    const fetch: GitHubFetch = async (input) => {
      const url = new URL(String(input));
      const headSha = url.searchParams.get('head_sha');
      const runs = headSha === 'merge-sha' ? [makeRun({ id: 4 as WorkflowRunId, head_sha: 'merge-sha', conclusion: 'success' })] : [
        makeRun({ id: 1 as WorkflowRunId, conclusion: 'success' }),
        makeRun({ id: 2 as WorkflowRunId, conclusion: 'success', event: 'push' }),
        makeRun({ id: 3 as WorkflowRunId, conclusion: 'success', pull_requests: [{ number: 99 }] }),
        makeRun({ id: 5 as WorkflowRunId, conclusion: 'success', head_sha: 'older-commit' })
      ];
      return jsonResponse({ total_count: runs.length, workflow_runs: runs });
    };

    const result = await getWorkflowStatus(input, createContext(fetch, 'merge-sha'));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.runs.map((run) => run.id)).toEqual([4, 2, 1]);
  });

  it.each([403, 404])('keeps workflow and job status when logs are unavailable (%s)', async (status) => {
    const result = await getWorkflowStatus(input, createContext(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/actions/runs')) return jsonResponse({ total_count: 1, workflow_runs: [makeRun()] });
      if (path.endsWith('/jobs')) return jsonResponse({ total_count: 1, jobs: [makeJob()] });
      return jsonResponse({ message: 'Logs unavailable' }, status);
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runs[0].failedJobs).toMatchObject({ kind: 'available', jobs: [{ conclusion: 'failure', logs: {
        kind: 'unavailable', detail: expect.stringContaining(`status=${status}`)
      } }] });
    }
  });

  it('reports job-list failures without losing workflow status', async () => {
    const result = await getWorkflowStatus(input, createContext(async (input) => new URL(String(input)).pathname.endsWith('/actions/runs')
      ? jsonResponse({ total_count: 1, workflow_runs: [makeRun()] })
      : jsonResponse({ message: 'Access denied' }, 403)));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.runs[0]).toMatchObject({ conclusion: 'failure', failedJobs: { kind: 'unavailable', detail: expect.stringContaining('403') } });
  });

  it('returns an explicit error when Actions read permission is missing', async () => {
    const result = await getWorkflowStatus(input, createContext(async () => jsonResponse({ message: 'Resource not accessible by integration' }, 403)));

    expect(result).toMatchObject({ ok: false, error: { kind: 'github_request_failed', operation: 'get_workflow_status', detail: expect.stringContaining('403') } });
  });

  it('bounds log output and marks excess failed jobs as unavailable', async () => {
    const jobs = Array.from({ length: 11 }, (_, index) => makeJob({ id: (index + 1) as WorkflowJobId }));
    const fetch = vi.fn<GitHubFetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/actions/runs')) return jsonResponse({ total_count: 1, workflow_runs: [makeRun()] });
      if (path.endsWith('/jobs')) return jsonResponse({ total_count: jobs.length, jobs });
      return new Response('x'.repeat(20_001));
    });

    const result = await getWorkflowStatus(input, createContext(fetch));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const failures = result.value.runs[0].failedJobs;
      if (failures.kind !== 'available') throw new Error('Jobs should be available');
      expect(failures.jobs).toHaveLength(11);
      expect(failures.jobs[0].logs).toEqual({ kind: 'available', text: 'x'.repeat(20_000), truncated: true });
      expect(failures.jobs[10].logs).toMatchObject({ kind: 'unavailable', detail: expect.stringContaining('limit') });
    }
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/logs'))).toHaveLength(10);
  });

  it('marks the upstream 1,000-run search limit instead of silently claiming completeness', async () => {
    const fetch = vi.fn<GitHubFetch>(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      return jsonResponse({ total_count: 1001, workflow_runs: Array.from({ length: 100 }, (_, index) => makeRun({
        id: ((page - 1) * 100 + index + 1) as WorkflowRunId, run_number: (page - 1) * 100 + index + 1, conclusion: 'success'
      })) });
    });

    const result = await getWorkflowStatus(input, createContext(fetch));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.truncated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('returns an empty list when there are no runs for the current commit', async () => {
    const result = await getWorkflowStatus(input, createContext(async () => jsonResponse({ total_count: 0, workflow_runs: [] })));

    expect(result).toEqual({ ok: true, value: { pullRequestNumber: 42, headSha: 'head-sha', mergeSha: null, runs: [], truncated: false } });
  });

  it('rejects invalid input before making requests', async () => {
    const fetch = vi.fn<GitHubFetch>();
    const result = await getWorkflowStatus({ ...input, repository: 'bad/slug/extra' }, createContext(fetch));

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation_rejected' } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
