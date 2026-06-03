import { describe, expect, it } from 'vitest';

import { createToolRegistry } from '#root/src/tools/registry.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { ok } from '#root/src/result.js';

function registeredMcpToolNames(context: ToolExecutionContext): string[] {
  return createToolRegistry(context)
    .filter((tool) => (tool.actorScopes as readonly string[]).includes('agent'))
    .map((tool) => tool.name);
}

function createMockContext(): ToolExecutionContext {
  return {
    github: {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql: {
        request: async () =>
          ok({
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                },
                comments: {
                  nodes: [],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                },
                labels: {
                  nodes: [],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          })
      },
      rest: {
        getCommitCombinedStatus: async () =>
          ok({
            state: 'pending',
            statuses: []
          })
      }
    },
    repository: {
      owner: 'openai',
      repo: 'gated-review'
    },
    copilotReviewerLogin: 'github-copilot[bot]'
  } as unknown as ToolExecutionContext;
}

function toolNamesForScope(scope: 'agent' | 'operator' | 'event_source') {
  return createToolRegistry(createMockContext())
    .filter((tool) => tool.actorScopes.some((actorScope) => actorScope === scope))
    .map((tool) => tool.name);
}

describe('registered MCP tool surface (agent gate)', () => {
  it('excludes operator-only verbs from the advertised tool list', () => {
    const names = registeredMcpToolNames(createMockContext());
    expect(names).not.toContain('merge_pr');
    expect(names).not.toContain('mark_merge_ready');
    expect(names).not.toContain('request_copilot_review');
    expect(names).not.toContain('review.record_event');
    expect(names).not.toContain('review.apply_decision');
  });

  it('includes the expected agent tools in the advertised tool list', () => {
    const names = registeredMcpToolNames(createMockContext());
    expect(names).toEqual(
      expect.arrayContaining([
        'get_review_round',
        'open_pr',
        'reply_to_thread',
        'resolve_thread',
        'request_next_round',
        'pr_status',
        'git.push',
        'git.pull',
        'git.fetch'
      ])
    );
  });
});

describe('tool actor restrictions', () => {
  it('keeps operator-only tools out of the agent view', () => {
    expect(toolNamesForScope('agent')).not.toContain('review.apply_decision');
    expect(toolNamesForScope('agent')).not.toContain('request_copilot_review');
    expect(toolNamesForScope('agent')).not.toContain('mark_merge_ready');
    expect(toolNamesForScope('agent')).not.toContain('merge_pr');
  });

  it('keeps operator-only tools out of the event_source view', () => {
    expect(toolNamesForScope('event_source')).not.toContain('review.apply_decision');
    expect(toolNamesForScope('event_source')).not.toContain('request_copilot_review');
    expect(toolNamesForScope('event_source')).not.toContain('mark_merge_ready');
    expect(toolNamesForScope('event_source')).not.toContain('merge_pr');
  });

  it('keeps the event_source view limited to receive-side and read tools', () => {
    expect(toolNamesForScope('event_source')).toEqual(
      expect.arrayContaining(['review.get_state', 'review.record_event', 'get_review_round', 'pr_status'])
    );
    expect(toolNamesForScope('event_source')).not.toContain('open_pr');
    expect(toolNamesForScope('event_source')).not.toContain('reply_to_thread');
    expect(toolNamesForScope('event_source')).not.toContain('resolve_thread');
    expect(toolNamesForScope('event_source')).not.toContain('request_next_round');
    expect(toolNamesForScope('event_source')).not.toContain('git.push');
    expect(toolNamesForScope('event_source')).not.toContain('git.pull');
    expect(toolNamesForScope('event_source')).not.toContain('git.fetch');
  });
});
