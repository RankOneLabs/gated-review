import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { err, ok, type Result } from '#root/src/result.js';
import { gitCommandFailedError, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { createGitHubExtraHeader, redactGitHubExtraHeader } from '#root/src/tools/git/credentials.js';
import { validateGitBranchName, validateGitRefspec } from '#root/src/tools/git/validation.js';

export type GitPushInput = Readonly<{
  repo_path: string;
  branch?: string;
  force_with_lease?: boolean;
}>;

export type GitPullInput = Readonly<{
  repo_path: string;
  branch?: string;
  rebase?: boolean;
}>;

export type GitFetchInput = Readonly<{
  repo_path: string;
  refspec?: string;
}>;

export type GitPushOutput = Readonly<{
  ok: true;
}>;

export type GitPullOutput = Readonly<{
  ok: true;
  head_sha: string;
}>;

export type GitFetchOutput = Readonly<{
  ok: true;
}>;

export type GitRunnerDependencies = Readonly<{
  installationId: number;
  tokenProvider: GitHubInstallationTokenProvider;
  githubHosts: readonly string[];
  spawn?: GitSpawn;
}>;

export type GitSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

type GitCommandKind = 'validate_repo_path' | 'current_branch' | 'remote_url' | 'push' | 'pull' | 'fetch' | 'head_sha' | 'token';

type SpawnedCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function defaultSpawn(command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) {
  return spawn(command, args, options);
}

function buildSpawnEnvironment() {
  return {
    ...process.env,
    GCM_INTERACTIVE: 'never',
    GIT_TERMINAL_PROMPT: '0'
  };
}

function trimStdout(stdout: string) {
  return stdout.trim();
}

function summarizeStderr(stderr: string) {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.slice(0, 3).join(' | ');
}

function toCommandError(operation: string, commandKind: GitCommandKind, detail: string): ToolDomainError {
  return gitCommandFailedError(operation, commandKind, detail);
}

function toValidationError(operation: string, detail: string): ToolDomainError {
  return validationRejectedError(operation, detail);
}

async function statDirectory(repoPath: string) {
  try {
    const repoStats = await stat(repoPath);
    if (!repoStats.isDirectory()) {
      return err(toValidationError('git.repository', 'repo_path must point to an existing directory.'));
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(toValidationError('git.repository', `repo_path does not exist: ${detail}`));
  }

  return ok(repoPath);
}

function executeGitCommand(
  spawnImpl: GitSpawn,
  commandKind: GitCommandKind,
  command: string,
  args: readonly string[]
): Promise<Result<SpawnedCommandResult, ToolDomainError>> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    let childProcess: ChildProcessWithoutNullStreams;
    try {
      childProcess = spawnImpl(command, args, {
        env: buildSpawnEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      resolve(err(toCommandError('git.command', commandKind, detail)));
      return;
    }

    childProcess.stdout.setEncoding('utf8');
    childProcess.stderr.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    childProcess.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    childProcess.once('error', (error: Error) => {
      resolve(err(toCommandError('git.command', commandKind, error.message)));
    });

    childProcess.once('close', (exitCode) => {
      if (exitCode !== 0) {
        resolve(
          err(
            toCommandError(
              'git.command',
              commandKind,
              `git exited with code ${exitCode ?? 'unknown'}: ${summarizeStderr(stderr)}`
            )
          )
        );
        return;
      }

      resolve(ok({ stdout, stderr, exitCode: exitCode ?? 0 }));
    });
  });
}

async function ensureRepository(
  repoPath: string,
  spawnImpl: GitSpawn
): Promise<Result<string, ToolDomainError>> {
  const stats = await statDirectory(repoPath);
  if (!stats.ok) {
    return stats;
  }

  const validation = await executeGitCommand(
    spawnImpl,
    'validate_repo_path',
    'git',
    ['-C', repoPath, 'rev-parse', '--is-inside-work-tree']
  );
  if (!validation.ok) {
    return err(
      toValidationError(
        'git.repository',
        `repo_path is not a git worktree: ${validation.error.detail}`
      )
    );
  }

  if (trimStdout(validation.value.stdout) !== 'true') {
    return err(toValidationError('git.repository', 'repo_path is not a git worktree.'));
  }

  return ok(repoPath);
}

async function resolveCurrentBranch(
  repoPath: string,
  spawnImpl: GitSpawn
): Promise<Result<string, ToolDomainError>> {
  const branchResult = await executeGitCommand(
    spawnImpl,
    'current_branch',
    'git',
    ['-C', repoPath, 'branch', '--show-current']
  );
  if (!branchResult.ok) {
    return branchResult;
  }

  const branchName = trimStdout(branchResult.value.stdout);
  if (branchName === '') {
    return err(toValidationError('git.branch', 'repo_path is on a detached HEAD; an explicit branch is required.'));
  }

  const validatedBranch = validateGitBranchName(branchName, 'git.branch');
  if (!validatedBranch.ok) {
    return validatedBranch;
  }

  return ok(validatedBranch.value);
}

async function resolveRemoteHost(
  repoPath: string,
  allowedHosts: readonly string[],
  spawnImpl: GitSpawn
): Promise<Result<string, ToolDomainError>> {
  const remoteResult = await executeGitCommand(
    spawnImpl,
    'remote_url',
    'git',
    ['-C', repoPath, 'remote', 'get-url', 'origin']
  );
  if (!remoteResult.ok) {
    return remoteResult;
  }

  const remoteUrl = trimStdout(remoteResult.value.stdout);
  if (remoteUrl === '') {
    return err(toValidationError('git.remote', 'origin remote URL is empty.'));
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(remoteUrl);
  } catch {
    return err(toValidationError('git.remote', 'origin remote must be an https GitHub URL.'));
  }

  if (parsedUrl.protocol !== 'https:') {
    return err(toValidationError('git.remote', 'origin remote must use https.'));
  }

  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    return err(toValidationError('git.remote', 'origin remote must not embed credentials.'));
  }

  if (!allowedHosts.includes(parsedUrl.host)) {
    return err(toValidationError('git.remote', `origin host ${parsedUrl.host} is not an allowed GitHub host.`));
  }

  return ok(parsedUrl.host);
}

async function resolveInstallationToken(
  dependencies: GitRunnerDependencies,
  operation: string
): Promise<Result<string, ToolDomainError>> {
  const mintedToken = await dependencies.tokenProvider.getInstallationToken(dependencies.installationId);
  if (!mintedToken.ok) {
    const message = mintedToken.error.message;
    return err(toCommandError(operation, 'token', message));
  }

  return ok(mintedToken.value);
}

function buildGitArgs(
  repoPath: string,
  extraHeader: string,
  command: readonly string[]
) {
  return ['-C', repoPath, '-c', extraHeader, ...command];
}

async function runRemoteGitCommand(
  dependencies: GitRunnerDependencies,
  operation: string,
  commandKind: GitCommandKind,
  repoPath: string,
  command: readonly string[]
): Promise<Result<SpawnedCommandResult, ToolDomainError>> {
  const host = await resolveRemoteHost(
    repoPath,
    dependencies.githubHosts,
    dependencies.spawn ?? defaultSpawn
  );
  if (!host.ok) {
    return host;
  }

  const token = await resolveInstallationToken(dependencies, operation);
  if (!token.ok) {
    return token;
  }

  const extraHeader = createGitHubExtraHeader(host.value, token.value);
  const args = buildGitArgs(repoPath, extraHeader, command);
  const result = await executeGitCommand(
    dependencies.spawn ?? defaultSpawn,
    commandKind,
    'git',
    args
  );
  if (!result.ok) {
    const sanitizedDetail = redactGitHubExtraHeader(result.error.detail, token.value);
    return err(toCommandError(operation, commandKind, sanitizedDetail));
  }

  return ok(result.value);
}

export async function pushGitRepository(
  input: GitPushInput,
  dependencies: GitRunnerDependencies
): Promise<Result<GitPushOutput, ToolDomainError>> {
  const repository = await ensureRepository(input.repo_path, dependencies.spawn ?? defaultSpawn);
  if (!repository.ok) {
    return repository;
  }

  const branchName =
    input.branch === undefined
      ? await resolveCurrentBranch(input.repo_path, dependencies.spawn ?? defaultSpawn)
      : validateGitBranchName(input.branch, 'git.push');
  if (!branchName.ok) {
    return branchName;
  }

  const command: string[] = ['push'];
  if (input.force_with_lease === true) {
    command.push('--force-with-lease');
  }
  command.push('origin', branchName.value);

  const result = await runRemoteGitCommand(
    dependencies,
    'git.push',
    'push',
    input.repo_path,
    command
  );
  if (!result.ok) {
    return result;
  }

  return ok({ ok: true });
}

export async function pullGitRepository(
  input: GitPullInput,
  dependencies: GitRunnerDependencies
): Promise<Result<GitPullOutput, ToolDomainError>> {
  const repository = await ensureRepository(input.repo_path, dependencies.spawn ?? defaultSpawn);
  if (!repository.ok) {
    return repository;
  }

  const branchName =
    input.branch === undefined
      ? await resolveCurrentBranch(input.repo_path, dependencies.spawn ?? defaultSpawn)
      : validateGitBranchName(input.branch, 'git.pull');
  if (!branchName.ok) {
    return branchName;
  }

  const command: string[] = ['pull'];
  if (input.rebase === true) {
    command.push('--rebase');
  }
  command.push('origin', branchName.value);

  const result = await runRemoteGitCommand(
    dependencies,
    'git.pull',
    'pull',
    input.repo_path,
    command
  );
  if (!result.ok) {
    return result;
  }

  const headSha = await executeGitCommand(
    dependencies.spawn ?? defaultSpawn,
    'head_sha',
    'git',
    ['-C', input.repo_path, 'rev-parse', 'HEAD']
  );
  if (!headSha.ok) {
    return err(toCommandError('git.pull', 'head_sha', headSha.error.detail));
  }

  const trimmedHeadSha = trimStdout(headSha.value.stdout);
  if (trimmedHeadSha === '') {
    return err(toValidationError('git.pull', 'git rev-parse HEAD returned an empty SHA.'));
  }

  return ok({ ok: true, head_sha: trimmedHeadSha });
}

export async function fetchGitRepository(
  input: GitFetchInput,
  dependencies: GitRunnerDependencies
): Promise<Result<GitFetchOutput, ToolDomainError>> {
  const repository = await ensureRepository(input.repo_path, dependencies.spawn ?? defaultSpawn);
  if (!repository.ok) {
    return repository;
  }

  const command: string[] = ['fetch', 'origin'];
  if (input.refspec !== undefined) {
    const refspec = validateGitRefspec(input.refspec, 'git.fetch');
    if (!refspec.ok) {
      return refspec;
    }

    command.push(refspec.value);
  }

  const result = await runRemoteGitCommand(
    dependencies,
    'git.fetch',
    'fetch',
    input.repo_path,
    command
  );
  if (!result.ok) {
    return result;
  }

  return ok({ ok: true });
}
