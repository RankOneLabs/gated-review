import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';

export function mapGitHubError(operation: string, error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(operation, `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}
