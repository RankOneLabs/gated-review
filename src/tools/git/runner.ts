import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { err, ok, type Result } from '#root/src/result.js';
import { gitCommandFailedError, validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import type { InstallationIdResolver } from '#root/src/github/rest.js';
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
  /** Fixed installation id (single-account mode); omit to resolve per remote owner. */
  installationId?: number;
  resolveInstallationId?: InstallationIdResolver;
  tokenProvider: GitHubInstallationTokenProvider;
  githubHosts: readonly string[];
  spawn?: GitSpawn;
  commandTimeoutMs?: number;
}>;

export type GitRunnerDependenciesProvider = () => Promise<Result<GitRunnerDependencies, ToolDomainError>>;

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
  args: readonly string[],
  timeoutMs = 60_000
): Promise<Result<SpawnedCommandResult, ToolDomainError>> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: Result<SpawnedCommandResult, ToolDomainError>) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      resolve(result);
    };

    let childProcess: ChildProcessWithoutNullStreams;
    try {
      childProcess = spawnImpl(command, args, {
        env: buildSpawnEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      finish(err(toCommandError('git.command', commandKind, detail)));
      return;
    }

    timeout = setTimeout(() => {
      childProcess.kill('SIGKILL');
      finish(err(toCommandError('git.command', commandKind, `git timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    childProcess.stdout.setEncoding('utf8');
    childProcess.stderr.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    childProcess.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    childProcess.once('error', (error: Error) => {
      finish(err(toCommandError('git.command', commandKind, error.message)));
    });

    childProcess.once('close', (exitCode) => {
      if (exitCode !== 0) {
        finish(
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

      finish(ok({ stdout, stderr, exitCode: exitCode ?? 0 }));
    });
  });
}

async function ensureRepository(
  repoPath: string,
  spawnImpl: GitSpawn,
  commandTimeoutMs?: number
): Promise<Result<string, ToolDomainError>> {
  const stats = await statDirectory(repoPath);
  if (!stats.ok) {
    return stats;
  }

  const validation = await executeGitCommand(
    spawnImpl,
    'validate_repo_path',
    'git',
    ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
    commandTimeoutMs
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
  spawnImpl: GitSpawn,
  commandTimeoutMs?: number
): Promise<Result<string, ToolDomainError>> {
  const branchResult = await executeGitCommand(
    spawnImpl,
    'current_branch',
    'git',
    ['-C', repoPath, 'branch', '--show-current'],
    commandTimeoutMs
  );
  if (!branchResult.ok) {
    return err(toValidationError('git.branch', branchResult.error.detail));
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

type RemoteTarget = Readonly<{ host: string; owner: string; repo: string }>;

/**
 * Parse a GitHub remote URL into host/owner/repo. Accepts the three forms a
 * checkout may carry: `https://host/owner/repo(.git)`, `ssh://git@host/owner/repo(.git)`,
 * and the scp-style `git@host:owner/repo(.git)`. The server always pushes over
 * https with an installation token (see runRemoteGitCommand), so an ssh `origin`
 * is first-class — only owner/repo/host are taken from it, never its transport.
 */
function parseGitRemoteTarget(remoteUrl: string): Result<RemoteTarget, string> {
  const stripDotGit = (value: string) => value.replace(/\.git$/, '');
  // Drop leading/trailing slashes so a trailing `/` does not register as an extra
  // empty segment; a valid GitHub repo path is exactly owner/repo(.git).
  const splitOwnerRepo = (path: string, host: string): Result<RemoteTarget, string> => {
    const segments = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
    const owner = segments[0] ?? '';
    const repo = stripDotGit(segments[1] ?? '');
    if (owner === '' || repo === '' || segments.length !== 2) {
      return err(`origin remote ${host} path must be owner/repo.`);
    }
    return ok({ host, owner, repo });
  };

  // scp-style `git@host:owner/repo` is not a parseable URL; it is distinguished
  // from ssh:// by the absence of a scheme separator.
  if (!remoteUrl.includes('://')) {
    const scpMatch = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(remoteUrl);
    if (scpMatch === null) {
      return err('origin remote must be a GitHub https or ssh URL.');
    }
    // Lowercase the host to match WHATWG URL parsing (which lowercases
    // `.hostname` for the https/ssh:// branches): the allowlist check is
    // case-sensitive, so a scp-style `git@GitHub.com:owner/repo` must
    // normalize to `github.com` or it would be wrongly rejected.
    return splitOwnerRepo(scpMatch[2], scpMatch[1].toLowerCase());
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(remoteUrl);
  } catch {
    return err('origin remote is not a valid URL.');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'ssh:') {
    return err('origin remote must use https or ssh.');
  }

  // An https origin must not carry a baked-in token; ssh user info (git@) is
  // expected and harmless since we never push over ssh.
  const embedsCredential =
    parsedUrl.protocol === 'https:'
      ? parsedUrl.username !== '' || parsedUrl.password !== ''
      : parsedUrl.password !== '';
  if (embedsCredential) {
    return err('origin remote must not embed credentials.');
  }

  // `.hostname` (not `.host`) intentionally drops any port: this server targets
  // github.com, which has no custom port or IPv6 host, and an `ssh://host:22`
  // remote must not carry its ssh port onto the constructed https URL. A
  // GitHub-Enterprise instance on a non-default https port or an IPv6 host is
  // out of scope; it would fail closed (allowlist reject), never misroute the
  // token. Revisit here if GHE/IPv6 support is ever needed.
  return splitOwnerRepo(parsedUrl.pathname, parsedUrl.hostname);
}

async function resolveRemoteHost(
  repoPath: string,
  allowedHosts: readonly string[],
  spawnImpl: GitSpawn,
  commandTimeoutMs?: number
): Promise<Result<RemoteTarget, ToolDomainError>> {
  const remoteResult = await executeGitCommand(
    spawnImpl,
    'remote_url',
    'git',
    ['-C', repoPath, 'remote', 'get-url', 'origin'],
    commandTimeoutMs
  );
  if (!remoteResult.ok) {
    return err(toValidationError('git.remote', remoteResult.error.detail));
  }

  const remoteUrl = trimStdout(remoteResult.value.stdout);
  if (remoteUrl === '') {
    return err(toValidationError('git.remote', 'origin remote URL is empty.'));
  }

  const target = parseGitRemoteTarget(remoteUrl);
  if (!target.ok) {
    return err(toValidationError('git.remote', target.error));
  }

  if (!allowedHosts.includes(target.value.host)) {
    return err(toValidationError('git.remote', `origin host ${target.value.host} is not an allowed GitHub host.`));
  }

  return ok(target.value);
}

async function resolveGitInstallationId(
  dependencies: GitRunnerDependencies,
  target: RemoteTarget,
  operation: string
): Promise<Result<number, ToolDomainError>> {
  if (dependencies.resolveInstallationId !== undefined) {
    const resolved = await dependencies.resolveInstallationId(target.owner, target.repo);
    if (!resolved.ok) {
      return err(toCommandError(operation, 'token', resolved.error.message));
    }
    return ok(resolved.value);
  }

  if (dependencies.installationId !== undefined) {
    return ok(dependencies.installationId);
  }

  return err(
    toCommandError(operation, 'token', 'No installation routing configured for git operations.')
  );
}

async function resolveInstallationToken(
  dependencies: GitRunnerDependencies,
  target: RemoteTarget,
  operation: string
): Promise<Result<string, ToolDomainError>> {
  const installationId = await resolveGitInstallationId(dependencies, target, operation);
  if (!installationId.ok) {
    return installationId;
  }

  const mintedToken = await dependencies.tokenProvider.getInstallationToken(installationId.value);
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
  const remote = await resolveRemoteHost(
    repoPath,
    dependencies.githubHosts,
    dependencies.spawn ?? defaultSpawn,
    dependencies.commandTimeoutMs
  );
  if (!remote.ok) {
    return remote;
  }

  const token = await resolveInstallationToken(dependencies, remote.value, operation);
  if (!token.ok) {
    return token;
  }

  const extraHeader = createGitHubExtraHeader(remote.value.host, token.value);
  // Target an explicit https URL rather than the literal `origin` remote, so an
  // ssh `origin` (which the installation token cannot authenticate) still works.
  // owner/repo/host come from origin; only the transport is forced to https.
  const remoteHttpsUrl = `https://${remote.value.host}/${remote.value.owner}/${remote.value.repo}.git`;
  const originIndex = command.indexOf('origin');
  const resolvedCommand =
    originIndex === -1
      ? command
      : [...command.slice(0, originIndex), remoteHttpsUrl, ...command.slice(originIndex + 1)];
  const args = buildGitArgs(repoPath, extraHeader, resolvedCommand);
  const result = await executeGitCommand(
    dependencies.spawn ?? defaultSpawn,
    commandKind,
    'git',
    args,
    dependencies.commandTimeoutMs
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
  const repository = await ensureRepository(
    input.repo_path,
    dependencies.spawn ?? defaultSpawn,
    dependencies.commandTimeoutMs
  );
  if (!repository.ok) {
    return repository;
  }

  const branchName =
    input.branch === undefined
      ? await resolveCurrentBranch(
          input.repo_path,
          dependencies.spawn ?? defaultSpawn,
          dependencies.commandTimeoutMs
        )
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
  const repository = await ensureRepository(
    input.repo_path,
    dependencies.spawn ?? defaultSpawn,
    dependencies.commandTimeoutMs
  );
  if (!repository.ok) {
    return repository;
  }

  const branchName =
    input.branch === undefined
      ? await resolveCurrentBranch(
          input.repo_path,
          dependencies.spawn ?? defaultSpawn,
          dependencies.commandTimeoutMs
        )
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
    ['-C', input.repo_path, 'rev-parse', 'HEAD'],
    dependencies.commandTimeoutMs
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
  const repository = await ensureRepository(
    input.repo_path,
    dependencies.spawn ?? defaultSpawn,
    dependencies.commandTimeoutMs
  );
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
