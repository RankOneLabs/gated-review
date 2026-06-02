import type { GitHubClient } from '#root/src/github/client.js';

export type ToolExecutionContext = Readonly<{
  github: GitHubClient;
}>;

export function createToolExecutionContext(github: GitHubClient): ToolExecutionContext {
  return { github };
}
