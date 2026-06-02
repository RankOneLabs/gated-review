import type { GitHubClient } from '#root/src/github/client.js';
import type { GitHubRepositoryScope } from '#root/src/github/rest.js';
import { loadGitHubAppConfig, type GitHubConfigEnvironment } from '#root/src/config.js';
import { createGitHubClient } from '#root/src/github/client.js';

export type ToolExecutionContext = Readonly<{
  github: GitHubClient;
  repository: GitHubRepositoryScope;
}>;

export function createToolExecutionContext(
  github: GitHubClient,
  repository: GitHubRepositoryScope
): ToolExecutionContext {
  return { github, repository };
}

function parseRepositoryScope(repository: string): GitHubRepositoryScope {
  const [owner, repo, ...rest] = repository.trim().split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error('GITHUB_REPOSITORY must be in owner/repo form.');
  }

  return { owner, repo };
}

export async function loadToolExecutionContext(
  env: GitHubConfigEnvironment = process.env
): Promise<ToolExecutionContext> {
  const config = await loadGitHubAppConfig(env);
  if (!config.ok) {
    throw new Error(config.error.detail);
  }

  const github = createGitHubClient(config.value);
  if (!github.ok) {
    throw new Error(github.error.message);
  }

  const repository = env.GITHUB_REPOSITORY;
  if (repository === undefined || repository.trim() === '') {
    throw new Error('GITHUB_REPOSITORY is required.');
  }

  return createToolExecutionContext(github.value, parseRepositoryScope(repository));
}
