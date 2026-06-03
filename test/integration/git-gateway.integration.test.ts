import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { ok } from '#root/src/result.js';
import { createGitFetchTool } from '#root/src/tools/git/fetch.js';
import type { GitSpawn } from '#root/src/tools/git/runner.js';
import { createGitPullTool } from '#root/src/tools/git/pull.js';
import { createGitPushTool } from '#root/src/tools/git/push.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8'
  });

  return result.stdout.trim();
}

function createGitSpawn(remoteUrl: string): GitSpawn {
  return (command, args, options) => {
    const child = new EventEmitter() as unknown as ReturnType<GitSpawn>;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout as never;
    child.stderr = stderr as never;

    queueMicrotask(async () => {
      try {
        if (
          command === 'git' &&
          args.includes('remote') &&
          args.includes('get-url') &&
          args.includes('origin')
        ) {
          stdout.end(`${remoteUrl}\n`);
          stderr.end('');
          child.emit('close', 0);
          return;
        }

        const result = await execFileAsync(command, args, {
          cwd: options.cwd,
          encoding: 'utf8',
          env: options.env
        });
        stdout.end(result.stdout);
        stderr.end(result.stderr);
        child.emit('close', 0);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        child.emit('error', new Error(detail));
      }
    });

    return child;
  };
}

function jsonFile(path: string, contents: string) {
  mkdirSync(dirname(path), {
    recursive: true
  });
  writeFileSync(path, contents, 'utf8');
}

async function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gated-review-git-'));
  const remoteRepo = join(root, 'remote', 'openai', 'gated-review.git');
  const repoPath = join(root, 'repo');
  const upstreamPath = join(root, 'upstream');

  mkdirSync(dirname(remoteRepo), {
    recursive: true
  });
  await git(root, ['init', '--bare', remoteRepo]);

  await git(root, ['init', '--initial-branch=main', repoPath]);
  await git(repoPath, ['config', 'user.email', 'dev@example.com']);
  await git(repoPath, ['config', 'user.name', 'Dev Example']);
  await git(repoPath, ['config', 'commit.gpgsign', 'false']);
  await git(repoPath, ['config', `url.file://${join(root, 'remote')}/.insteadOf`, 'https://github.com/']);
  await git(repoPath, ['remote', 'add', 'origin', 'https://github.com/openai/gated-review.git']);

  jsonFile(join(repoPath, 'README.md'), '# gated-review\n');
  await git(repoPath, ['add', 'README.md']);
  await git(repoPath, ['commit', '-m', 'seed']);
  await git(repoPath, ['push', 'origin', 'main']);

  await git(root, ['init', '--initial-branch=main', upstreamPath]);
  await git(upstreamPath, ['config', 'user.email', 'dev@example.com']);
  await git(upstreamPath, ['config', 'user.name', 'Dev Example']);
  await git(upstreamPath, ['config', 'commit.gpgsign', 'false']);
  await git(upstreamPath, ['config', `url.file://${join(root, 'remote')}/.insteadOf`, 'https://github.com/']);
  await git(upstreamPath, ['remote', 'add', 'origin', 'https://github.com/openai/gated-review.git']);
  await git(upstreamPath, ['fetch', 'origin', 'main']);
  await git(upstreamPath, ['checkout', '-b', 'main', 'FETCH_HEAD']);

  return {
    root,
    remoteRepo,
    repoPath,
    upstreamPath
  };
}

describe('git gateway integration', () => {
  it('pushes, pulls, and fetches against a local bare remote', async () => {
    const fixture = await createGitFixture();
    const dependenciesProvider = async () =>
      ok({
        installationId: 99,
        tokenProvider: {
          async getInstallationToken() {
            return ok('installation-token');
          }
        },
        githubHosts: ['github.com'],
        spawn: createGitSpawn('https://github.com/openai/gated-review.git')
      });

    jsonFile(join(fixture.repoPath, 'src', 'push.txt'), 'push me\n');
    await git(fixture.repoPath, ['add', 'src/push.txt']);
    await git(fixture.repoPath, ['commit', '-m', 'local push change']);

    const pushResult = await createGitPushTool(dependenciesProvider).handler({
      repository: 'openai/gated-review',
      repo_path: fixture.repoPath
    });
    expect(pushResult).toEqual({ ok: true, value: { ok: true } });
    expect(await git(fixture.remoteRepo, ['rev-parse', 'refs/heads/main'])).toBe(
      await git(fixture.repoPath, ['rev-parse', 'HEAD'])
    );

    await git(fixture.upstreamPath, ['fetch', 'origin', 'main']);
    await git(fixture.upstreamPath, ['checkout', '-B', 'main', 'FETCH_HEAD']);
    jsonFile(join(fixture.upstreamPath, 'src', 'pull.txt'), 'pull me\n');
    await git(fixture.upstreamPath, ['add', 'src/pull.txt']);
    await git(fixture.upstreamPath, ['commit', '-m', 'upstream pull change']);
    await git(fixture.upstreamPath, ['push', 'origin', 'main']);

    const pullResult = await createGitPullTool(dependenciesProvider).handler({
      repository: 'openai/gated-review',
      repo_path: fixture.repoPath,
      rebase: true
    });
    expect(pullResult.ok).toBe(true);
    if (pullResult.ok) {
      expect(pullResult.value.head_sha).toBe(await git(fixture.repoPath, ['rev-parse', 'HEAD']));
    }

    await git(fixture.upstreamPath, ['checkout', '-b', 'feature']);
    jsonFile(join(fixture.upstreamPath, 'src', 'fetch.txt'), 'fetch me\n');
    await git(fixture.upstreamPath, ['add', 'src/fetch.txt']);
    await git(fixture.upstreamPath, ['commit', '-m', 'upstream fetch change']);
    await git(fixture.upstreamPath, ['push', 'origin', 'feature']);

    const fetchResult = await createGitFetchTool(dependenciesProvider).handler({
      repository: 'openai/gated-review',
      repo_path: fixture.repoPath,
      refspec: 'refs/heads/feature:refs/remotes/origin/feature'
    });
    expect(fetchResult).toEqual({ ok: true, value: { ok: true } });
    expect(
      await git(fixture.repoPath, ['rev-parse', 'refs/remotes/origin/feature'])
    ).toBe(await git(fixture.remoteRepo, ['rev-parse', 'refs/heads/feature']));
  });
});
