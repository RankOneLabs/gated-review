import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { fetchGitRepository, pullGitRepository, pushGitRepository, type GitSpawn } from '#root/src/tools/git/runner.js';

type SpawnResponse = Readonly<{
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  throwError?: string;
}>;

function createSpawnMock(responses: SpawnResponse[]) {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const spawn: GitSpawn = vi.fn((command, args) => {
    calls.push({ command, args });

    const response = responses.shift();
    if (response?.throwError !== undefined) {
      throw new Error(response.throwError);
    }

    const child = new EventEmitter() as unknown as ReturnType<GitSpawn>;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout as never;
    child.stderr = stderr as never;

    queueMicrotask(() => {
      if (response?.stdout !== undefined) {
        stdout.end(response.stdout);
      } else {
        stdout.end();
      }

      if (response?.stderr !== undefined) {
        stderr.end(response.stderr);
      } else {
        stderr.end();
      }

      child.emit('close', response?.exitCode ?? 0);
    });

    return child as ReturnType<GitSpawn>;
  });

  return { spawn, calls };
}

function createTokenProvider(token: string): GitHubInstallationTokenProvider {
  return {
    async getInstallationToken() {
      return { ok: true, value: token };
    }
  };
}

describe('git runner', () => {
  it('pushes the current branch through an authenticated subprocess', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'gated-review-'));
    const { spawn, calls } = createSpawnMock([
      { stdout: 'true\n' },
      { stdout: 'feature/main\n' },
      { stdout: 'https://github.com/example/repo.git\n' },
      { stdout: '', stderr: '', exitCode: 0 }
    ]);

    const result = await pushGitRepository(
      { repo_path: repoPath },
      {
        installationId: 42,
        tokenProvider: createTokenProvider('token-123'),
        spawn
      }
    );

    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(calls.map((call) => call.args)).toEqual([
      ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
      ['-C', repoPath, 'branch', '--show-current'],
      ['-C', repoPath, 'remote', 'get-url', 'origin'],
      [
        '-C',
        repoPath,
        '-c',
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
          'x-access-token:token-123',
          'utf8'
        ).toString('base64')}`,
        'push',
        'origin',
        'feature/main'
      ]
    ]);
  });

  it('pulls with rebase and returns the resulting HEAD sha', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'gated-review-'));
    const { spawn, calls } = createSpawnMock([
      { stdout: 'true\n' },
      { stdout: 'feature/main\n' },
      { stdout: 'https://github.com/example/repo.git\n' },
      { stdout: '', stderr: '', exitCode: 0 },
      { stdout: 'abc123\n' }
    ]);

    const result = await pullGitRepository(
      { repo_path: repoPath, rebase: true },
      {
        installationId: 42,
        tokenProvider: createTokenProvider('token-123'),
        spawn
      }
    );

    expect(result).toEqual({ ok: true, value: { ok: true, head_sha: 'abc123' } });
    expect(calls.map((call) => call.args)).toEqual([
      ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
      ['-C', repoPath, 'branch', '--show-current'],
      ['-C', repoPath, 'remote', 'get-url', 'origin'],
      [
        '-C',
        repoPath,
        '-c',
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
          'x-access-token:token-123',
          'utf8'
        ).toString('base64')}`,
        'pull',
        '--rebase',
        'origin',
        'feature/main'
      ],
      ['-C', repoPath, 'rev-parse', 'HEAD']
    ]);
  });

  it('fetches a refspec with a sanitized failure message', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'gated-review-'));
    const { spawn } = createSpawnMock([
      { stdout: 'true\n' },
      { stdout: 'https://github.com/example/repo.git\n' },
      {
        stdout: '',
        stderr: 'fatal: AUTHORIZATION: basic dG9rZW4=\n',
        exitCode: 128
      }
    ]);

    const result = await fetchGitRepository(
      { repo_path: repoPath, refspec: 'refs/heads/main:refs/remotes/origin/main' },
      {
        installationId: 42,
        tokenProvider: createTokenProvider('token-123'),
        spawn
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('git_command_failed');
      if (result.error.kind === 'git_command_failed') {
        expect(result.error.commandKind).toBe('fetch');
      }
      expect(result.error.detail).toContain('git exited with code 128');
      expect(result.error.detail).toContain('AUTHORIZATION: basic [redacted]');
      expect(result.error.detail).not.toContain('token-123');
    }
  });
});
