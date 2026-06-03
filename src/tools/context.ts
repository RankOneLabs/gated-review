import type { GitHubClient } from '#root/src/github/client.js';
import { loadGitHubAppConfig, type GitHubConfigEnvironment } from '#root/src/config.js';
import { createGitHubClient } from '#root/src/github/client.js';

export type ToolExecutionContext = Readonly<{
  github: GitHubClient;
  copilotReviewerLogin: string;
}>;

export function createToolExecutionContext(
  github: GitHubClient,
  copilotReviewerLogin = 'copilot[bot]'
): ToolExecutionContext {
  return { github, copilotReviewerLogin };
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

  return createToolExecutionContext(github.value, config.value.copilotReviewerLogin);
}
