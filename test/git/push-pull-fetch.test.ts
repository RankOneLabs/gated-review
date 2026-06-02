import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { createGitFetchTool } from '#root/src/tools/git/fetch.js';
import type { GitSpawn } from '#root/src/tools/git/runner.js';
import { createGitPullTool as createPullTool } from '#root/src/tools/git/pull.js';
import { createGitPushTool as createPushTool } from '#root/src/tools/git/push.js';

type SpawnResponse = Readonly<{
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}>;

function createSpawnMock(responses: SpawnResponse[]) {
  const spawn: GitSpawn = vi.fn((command, args) => {
    const response = responses.shift();
    const child = new EventEmitter() as unknown as ReturnType<GitSpawn>;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout as never;
    child.stderr = stderr as never;

    queueMicrotask(() => {
      stdout.end(response?.stdout ?? '');
      stderr.end(response?.stderr ?? '');
      child.emit('close', response?.exitCode ?? 0);
    });

    return child as ReturnType<GitSpawn>;
  });

  return spawn;
}

function createTokenProvider(token: string): GitHubInstallationTokenProvider {
  return {
    async getInstallationToken() {
      return { ok: true, value: token };
    }
  };
}

describe('git tool handlers', () => {
  it('pushes through the registered tool contract', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'gated-review-'));
    const spawn = createSpawnMock([
      { stdout: 'true\n' },
      { stdout: 'feature/main\n' },
      { stdout: 'https://github.com/example/repo.git\n' },
      { exitCode: 0 }
    ]);
    const provider = async () => ({
      ok: true as const,
      value: {
        installationId: 42,
        tokenProvider: createTokenProvider('token-123'),
        spawn
      }
    });

    const tool = createPushTool(provider);
    const result = await tool.handler({ repo_path: repoPath });

    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('pulls through the registered tool contract', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'gated-review-'));
    const spawn = createSpawnMock([
      { stdout: 'true\n' },
      { stdout: 'feature/main\n' },
      { stdout: 'https://github.com/example/repo.git\n' },
      { exitCode: 0 },
      { stdout: 'abc123\n' }
    ]);
    const provider = async () => ({
      ok: true as const,
      value: {
        installationId: 42,
        tokenProvider: createTokenProvider('token-123'),
        spawn
      }
    });

    const tool = createPullTool(provider);
    const result = await tool.handler({ repo_path: repoPath, rebase: true });

    expect(result).toEqual({ ok: true, value: { ok: true, head_sha: 'abc123' } });
  });

  it('fetches through the registered tool contract', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'gated-review-'));
    const spawn = createSpawnMock([
      { stdout: 'true\n' },
      { stdout: 'https://github.com/example/repo.git\n' },
      { exitCode: 0 }
    ]);
    const provider = async () => ({
      ok: true as const,
      value: {
        installationId: 42,
        tokenProvider: createTokenProvider('token-123'),
        spawn
      }
    });

    const tool = createGitFetchTool(provider);
    const result = await tool.handler({
      repo_path: repoPath,
      refspec: 'refs/heads/main:refs/remotes/origin/main'
    });

    expect(result).toEqual({ ok: true, value: { ok: true } });
  });
});
