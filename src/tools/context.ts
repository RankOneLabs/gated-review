import type { GitHubClient } from '#root/src/github/client.js';
import type { GitHubRepositoryScope } from '#root/src/github/rest.js';

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
