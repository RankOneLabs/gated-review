import { describe, expect, it, vi } from 'vitest';

import { ok } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { surfaceForPath, toolsForSurface, type McpSurface } from '#root/src/tools/agent-roles.js';
import { createToolRegistry } from '#root/src/tools/registry.js';

const pullRequestUrl = 'https://github.com/openai/gated-review/pull/42';

function createContext() {
  const createPullRequest = vi.fn(async (_repository: unknown, _request: unknown) =>
    ok({ number: 42, html_url: pullRequestUrl, state: 'open' })
  );
  const graphqlRequest = vi.fn(async (input: { operationName: string }) => {
    if (input.operationName === 'PullRequestDraftState') {
      return ok({ repository: { pullRequest: { id: 'PR_node_42', number: 42, url: pullRequestUrl, isDraft: true } } });
    }
    return ok({ markPullRequestReadyForReview: { pullRequest: { number: 42, url: pullRequestUrl, isDraft: false } } });
  });

  const context = {
    github: {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql: { request: graphqlRequest },
      rest: { createPullRequest }
    },
    copilotReviewerLogin: 'github-copilot[bot]'
  } as unknown as ToolExecutionContext;

  return { context, createPullRequest, graphqlRequest };
}

const builder: McpSurface = { kind: 'role', role: 'builder' };
const assessor: McpSurface = { kind: 'role', role: 'assessor' };
const unscoped: McpSurface = { kind: 'agent' };

function surfaceTools(surface: McpSurface, context = createContext().context) {
  return toolsForSurface(createToolRegistry(context), surface);
}

function surfaceToolNames(surface: McpSurface) {
  return surfaceTools(surface).map((tool) => tool.name);
}

function surfaceTool(surface: McpSurface, name: string, context: ToolExecutionContext) {
  const tool = surfaceTools(surface, context).find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`${name} is not on the surface`);
  }
  return tool;
}

const openPrInput = {
  repository: 'openai/gated-review',
  base: 'main',
  head: 'feature',
  title: 'Add feature'
};

describe('surfaceForPath', () => {
  it('maps /mcp to the unscoped agent surface', () => {
    expect(surfaceForPath('/mcp')).toEqual({ kind: 'agent' });
  });

  it('maps /mcp/<role> to that role', () => {
    expect(surfaceForPath('/mcp/builder')).toEqual(builder);
    expect(surfaceForPath('/mcp/assessor')).toEqual(assessor);
  });

  it('rejects unknown paths and roles', () => {
    expect(surfaceForPath('/mcp/operator')).toBeNull();
    expect(surfaceForPath('/other')).toBeNull();
    expect(surfaceForPath(undefined)).toBeNull();
  });
});

describe('unscoped agent surface', () => {
  it('is the agent-scoped registry, without set_pr_draft', () => {
    const agentScoped = createToolRegistry(createContext().context)
      .filter((tool) => tool.actorScopes.some((scope) => scope === 'agent'))
      .map((tool) => tool.name);
    expect(surfaceToolNames(unscoped)).toEqual(agentScoped);
    expect(surfaceToolNames(unscoped)).not.toContain('set_pr_draft');
  });
});

describe('builder surface', () => {
  it('offers the unscoped agent tools and nothing else', () => {
    expect(surfaceToolNames(builder)).toEqual(surfaceToolNames(unscoped));
  });

  it('has no set_pr_draft', () => {
    expect(surfaceToolNames(builder)).not.toContain('set_pr_draft');
  });

  it('opens a pull request as a draft when draft is omitted', async () => {
    const { context, createPullRequest } = createContext();

    const result = await surfaceTool(builder, 'open_pr', context).handler(openPrInput);

    expect(result.ok).toBe(true);
    expect(createPullRequest.mock.calls[0]?.[1]).toMatchObject({ draft: true });
  });

  it('rejects draft: false without calling GitHub', async () => {
    const { context, createPullRequest } = createContext();

    const result = await surfaceTool(builder, 'open_pr', context).handler({ ...openPrInput, draft: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_rejected');
      expect(result.error.detail).toContain('role=builder');
      expect(result.error.detail).toContain('repository=openai/gated-review');
    }
    expect(createPullRequest).not.toHaveBeenCalled();
  });
});

describe('assessor surface', () => {
  it('offers only read tools and set_pr_draft', () => {
    expect(surfaceToolNames(assessor)).toEqual([
      'review.get_state',
      'review.list_actions',
      'set_pr_draft',
      'git.fetch',
      'get_review_round',
      'pr_status'
    ]);
  });

  it('cannot open pull requests, push, pull or write to threads', () => {
    const names = surfaceToolNames(assessor);
    for (const name of ['open_pr', 'git.push', 'git.pull', 'reply_to_thread', 'resolve_thread', 'request_next_round']) {
      expect(names).not.toContain(name);
    }
  });

  it('marks a pull request ready for review', async () => {
    const { context } = createContext();

    const result = await surfaceTool(assessor, 'set_pr_draft', context).handler({
      repository: 'openai/gated-review',
      pullRequestNumber: 42,
      draft: false
    });

    expect(result).toEqual({ ok: true, value: { number: 42, url: pullRequestUrl, isDraft: false } });
  });

  it('rejects draft: true without calling GitHub', async () => {
    const { context, graphqlRequest } = createContext();

    const result = await surfaceTool(assessor, 'set_pr_draft', context).handler({
      repository: 'openai/gated-review',
      pullRequestNumber: 42,
      draft: true
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_rejected');
      expect(result.error.detail).toContain('role=assessor');
      expect(result.error.detail).toContain('repository=openai/gated-review');
    }
    expect(graphqlRequest).not.toHaveBeenCalled();
  });
});
