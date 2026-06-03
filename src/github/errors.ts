export type GitHubErrorCategory = 'configuration' | 'authentication' | 'graphql' | 'rest' | 'transport';

export type GitHubError = {
  kind: 'github_error';
  category: GitHubErrorCategory;
  operation: string;
  message: string;
  requestLabel: string;
  status?: number;
};

export type GitHubErrorInput = {
  category: GitHubErrorCategory;
  operation: string;
  message: string;
  requestLabel: string;
  status?: number;
};

export function createGitHubError(input: GitHubErrorInput): GitHubError {
  return {
    kind: 'github_error',
    category: input.category,
    operation: input.operation,
    message: input.message,
    requestLabel: input.requestLabel,
    ...(input.status === undefined ? {} : { status: input.status })
  };
}
