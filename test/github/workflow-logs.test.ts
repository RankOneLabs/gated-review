import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';
import type { WorkflowJobId } from '#root/src/github/workflows.js';

const repository = { owner: 'acme', repo: 'demo' };
const jobId = 42 as WorkflowJobId;

function createClient(fetch: GitHubFetch) {
  return createGitHubRestClient({
    baseUrl: 'https://github.example/api/v3', installationId: 99,
    tokenProvider: { async getInstallationToken() { return ok('installation-secret'); } }
  }, { fetch });
}

describe('workflow log downloads', () => {
  it('authenticates the API request and downloads the signed URL without credentials', async () => {
    const fetch = vi.fn<GitHubFetch>(async (input) => String(input).includes('/api/v3/')
      ? new Response(null, { status: 302, headers: { location: 'https://logs.example/job?signed=secret' } })
      : new Response('test failed\nstack trace'));

    const result = await createClient(fetch).getWorkflowJobLogs({ repository, jobId, maxCharacters: 100 });

    expect(result).toEqual({ ok: true, value: { text: 'test failed\nstack trace', truncated: false } });
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://github.example/api/v3/repos/acme/demo/actions/jobs/42/logs');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer installation-secret');
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).has('authorization')).toBe(false);
    expect(fetch.mock.calls[1]?.[1]?.redirect).toBe('error');
  });

  it('retains the tail of streamed logs and decodes split UTF-8 characters', async () => {
    const bytes = new TextEncoder().encode('setup output\nerror: 💥');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, bytes.length - 2));
        controller.enqueue(bytes.slice(bytes.length - 2));
        controller.close();
      }
    });
    const result = await createClient(async () => new Response(stream)).getWorkflowJobLogs({ repository, jobId, maxCharacters: 9 });

    expect(result).toEqual({ ok: true, value: { text: 'error: 💥', truncated: true } });
  });

  it.each([null, 'http://logs.example/job', 'https://user:password@logs.example/job'])('rejects invalid log redirects (%s)', async (location) => {
    const fetch = vi.fn<GitHubFetch>(async () => new Response(null, {
      status: 302, headers: location === null ? {} : { location }
    }));
    const result = await createClient(fetch).getWorkflowJobLogs({ repository, jobId, maxCharacters: 100 });

    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not expose signed URLs or credentials when a download fails', async () => {
    const fetch = vi.fn<GitHubFetch>(async (input) => {
      if (String(input).includes('/api/v3/')) {
        return new Response(null, { status: 302, headers: { location: 'https://logs.example/job?signed=secret' } });
      }
      throw new Error(`failed at ${String(input)} installation-secret`);
    });
    const result = await createClient(fetch).getWorkflowJobLogs({ repository, jobId, maxCharacters: 100 });

    expect(result).toMatchObject({ ok: false, error: { category: 'transport', operation: 'get_workflow_job_logs' } });
    expect(JSON.stringify(result)).not.toContain('signed=secret');
    expect(JSON.stringify(result)).not.toContain('installation-secret');
  });

  it('returns a shaped error for expired or unavailable logs', async () => {
    const result = await createClient(async () => new Response('{"message":"Logs expired"}', { status: 404 }))
      .getWorkflowJobLogs({ repository, jobId, maxCharacters: 100 });

    expect(result).toMatchObject({ ok: false, error: { status: 404, message: 'Logs expired' } });
  });

  it('rejects a zero log limit before it can cause an unbounded download', async () => {
    const fetch = vi.fn<GitHubFetch>();
    const result = await createClient(fetch).getWorkflowJobLogs({ repository, jobId, maxCharacters: 0 });

    expect(result).toMatchObject({ ok: false, error: { category: 'configuration' } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
