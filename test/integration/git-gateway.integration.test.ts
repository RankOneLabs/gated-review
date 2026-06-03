import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitFetchTool } from '#root/src/tools/git/fetch.js';
import type { GitSpawn } from '#root/src/tools/git/runner.js';
import { createGitPullTool } from '#root/src/tools/git/pull.js';
import { createGitPushTool } from '#root/src/tools/git/push.js';

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8'
  }).trim();
}

function jsonFile(path: string, contents: string) {
  mkdirSync(dirname(path), {
    recursive: true
  });
  writeFileSync(path, contents, 'utf8');
}

function createRemoteUrlSpawn(remoteUrl: string): GitSpawn {
  return (command, args, options) => {
    if (
      command === 'git' &&
      args.includes('remote') &&
      args.includes('get-url') &&
      args.includes('origin')
    ) {
      const child = new EventEmitter() as unknown as ReturnType<GitSpawn>;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      child.stdout = stdout as never;
      child.stderr = stderr as never;

      queueMicrotask(() => {
        stdout.end(`${remoteUrl}\n`);
        stderr.end('');
        child.emit('close', 0);
      });

      return child as ReturnType<GitSpawn>;
    }

    return spawn(command, args, options);
  };
}

function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gated-review-git-'));
  const remoteRepo = join(root, 'remote', 'openai', 'gated-review.git');
  const repoPath = join(root, 'repo');
  const upstreamPath = join(root, 'upstream');

  mkdirSync(dirname(remoteRepo), {
    recursive: true
  });
  git(root, ['init', '--bare', remoteRepo]);

  git(root, ['init', '--initial-branch=main', repoPath]);
  git(repoPath, ['config', 'user.email', 'dev@example.com']);
  git(repoPath, ['config', 'user.name', 'Dev Example']);
  git(repoPath, ['config', 'commit.gpgsign', 'false']);
  git(repoPath, ['remote', 'add', 'origin', remoteRepo]);

  jsonFile(join(repoPath, 'README.md'), '# gated-review\n');
  git(repoPath, ['add', 'README.md']);
  git(repoPath, ['commit', '-m', 'seed']);
  git(repoPath, ['push', 'origin', 'main']);

  git(root, ['init', '--initial-branch=main', upstreamPath]);
  git(upstreamPath, ['config', 'user.email', 'dev@example.com']);
  git(upstreamPath, ['config', 'user.name', 'Dev Example']);
  git(upstreamPath, ['config', 'commit.gpgsign', 'false']);
  git(upstreamPath, ['remote', 'add', 'origin', remoteRepo]);
  git(upstreamPath, ['fetch', 'origin', 'main']);
  git(upstreamPath, ['checkout', '-b', 'main', 'FETCH_HEAD']);

  return {
    root,
    remoteRepo,
    repoPath,
    upstreamPath
  };
}

describe('git gateway integration', () => {
  it('pushes, pulls, and fetches against a local bare remote', async () => {
    const fixture = createGitFixture();
    const dependenciesProvider = async () =>
      ok({
        installationId: 99,
        tokenProvider: {
          async getInstallationToken() {
            return ok('installation-token');
          }
        },
        githubHosts: ['github.com'],
        spawn: createRemoteUrlSpawn('https://github.com/openai/gated-review.git')
      });

    jsonFile(join(fixture.repoPath, 'src', 'push.txt'), 'push me\n');
    git(fixture.repoPath, ['add', 'src/push.txt']);
    git(fixture.repoPath, ['commit', '-m', 'local push change']);

    const pushResult = await createGitPushTool(dependenciesProvider).handler({
      repo_path: fixture.repoPath
    });
    expect(pushResult).toEqual({ ok: true, value: { ok: true } });
    expect(git(fixture.remoteRepo, ['rev-parse', 'refs/heads/main'])).toBe(
      git(fixture.repoPath, ['rev-parse', 'HEAD'])
    );

    git(fixture.upstreamPath, ['fetch', 'origin', 'main']);
    git(fixture.upstreamPath, ['checkout', '-B', 'main', 'FETCH_HEAD']);
    jsonFile(join(fixture.upstreamPath, 'src', 'pull.txt'), 'pull me\n');
    git(fixture.upstreamPath, ['add', 'src/pull.txt']);
    git(fixture.upstreamPath, ['commit', '-m', 'upstream pull change']);
    git(fixture.upstreamPath, ['push', 'origin', 'main']);

    const pullResult = await createGitPullTool(dependenciesProvider).handler({
      repo_path: fixture.repoPath,
      rebase: true
    });
    expect(pullResult.ok).toBe(true);
    if (pullResult.ok) {
      expect(pullResult.value.head_sha).toBe(git(fixture.repoPath, ['rev-parse', 'HEAD']));
    }

    git(fixture.upstreamPath, ['checkout', '-b', 'feature']);
    jsonFile(join(fixture.upstreamPath, 'src', 'fetch.txt'), 'fetch me\n');
    git(fixture.upstreamPath, ['add', 'src/fetch.txt']);
    git(fixture.upstreamPath, ['commit', '-m', 'upstream fetch change']);
    git(fixture.upstreamPath, ['push', 'origin', 'feature']);

    const fetchResult = await createGitFetchTool(dependenciesProvider).handler({
      repo_path: fixture.repoPath,
      refspec: 'refs/heads/feature:refs/remotes/origin/feature'
    });
    expect(fetchResult).toEqual({ ok: true, value: { ok: true } });
    expect(
      git(fixture.repoPath, ['rev-parse', 'refs/remotes/origin/feature'])
    ).toBe(git(fixture.remoteRepo, ['rev-parse', 'refs/heads/feature']));
  });
});
