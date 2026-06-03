import type { GitHubClient } from '#root/src/github/client.js';
import type { GitHubRepositoryScope } from '#root/src/github/rest.js';
import { loadGitHubAppConfig, type GitHubConfigEnvironment } from '#root/src/config.js';
import { createGitHubClient } from '#root/src/github/client.js';
import { resolveRepositoryScope } from '#root/src/tools/mutations/repository.js';

export type ToolExecutionContext = Readonly<{
  github: GitHubClient;
  repository: GitHubRepositoryScope;
  copilotReviewerLogin: string;
}>;

export function createToolExecutionContext(
  github: GitHubClient,
  repository: GitHubRepositoryScope,
  copilotReviewerLogin = 'copilot[bot]'
): ToolExecutionContext {
  return { github, repository, copilotReviewerLogin };
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

  const repository = await resolveRepositoryScope(env);
  if (!repository.ok) {
    throw new Error(repository.error.detail);
  }

  return createToolExecutionContext(github.value, repository.value, config.value.copilotReviewerLogin);
}
