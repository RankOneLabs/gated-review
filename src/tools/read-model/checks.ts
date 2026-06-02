import type { GitHubCombinedStatusResponse } from '#root/src/github/rest.js';
import type { ReadModelChecksSummary } from '#root/src/tools/read-model/types.js';

function mapCombinedState(state: string): ReadModelChecksSummary['state'] {
  if (state === 'success') {
    return 'passing';
  }

  if (state === 'pending') {
    return 'pending';
  }

  return 'failing';
}

export function summarizeChecks(response: GitHubCombinedStatusResponse): ReadModelChecksSummary {
  const contexts = response.statuses.map((status) => ({
    context: status.context,
    state: status.state as ReadModelChecksSummary['contexts'][number]['state']
  }));

  const failingCount = contexts.filter((context) => context.state === 'failure' || context.state === 'error').length;
  const pendingCount = contexts.filter((context) => context.state === 'pending').length;

  return {
    state: mapCombinedState(response.state),
    totalCount: contexts.length,
    failingCount,
    pendingCount,
    contexts
  };
}
