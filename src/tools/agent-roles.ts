import type { ZodTypeAny } from 'zod';

import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { OpenPrInput } from '#root/src/tools/mutations/open-pr.js';
import type { ToolName } from '#root/src/tools/registry.js';
import type { ToolContract } from '#root/src/tools/types.js';

// An agent session connects as one of these roles by choosing its MCP endpoint
// (`/mcp/builder`, `/mcp/assessor`). The role fixes its tool set and input policy for
// the life of the session; the agent cannot change its own MCP configuration.
export const agentRoles = ['builder', 'assessor'] as const;

export type AgentRole = (typeof agentRoles)[number];

export type McpSurface = Readonly<{ kind: 'agent' }> | Readonly<{ kind: 'role'; role: AgentRole }>;

export const unscopedAgentSurface: McpSurface = { kind: 'agent' };

type RegisteredTool = ToolContract<ZodTypeAny, ZodTypeAny, string>;

// Narrows what a role may ask of a tool: returns the input to run, or a rejection.
type InputPolicy<TInput> = (input: TInput, role: AgentRole) => Result<TInput, ToolDomainError>;

// `never` admits a policy over any one tool's input; the grant names that tool.
type AnyInputPolicy = (input: never, role: AgentRole) => Result<unknown, ToolDomainError>;

type RoleGrant = Readonly<{
  name: ToolName;
  policy?: AnyInputPolicy;
  descriptionNote?: string;
}>;

const builderOpensDrafts: InputPolicy<OpenPrInput> = (input, role) => {
  if (input.draft === false) {
    return err(
      validationRejectedError(
        'open_pr',
        `role=${role} may only open draft pull requests; repository=${input.repository} head=${input.head}`
      )
    );
  }
  return ok({ ...input, draft: true });
};

const roleGrants: Readonly<Record<AgentRole, readonly RoleGrant[]>> = {
  builder: [
    { name: 'review.get_state' },
    { name: 'review.list_actions' },
    {
      name: 'open_pr',
      policy: builderOpensDrafts,
      descriptionNote: 'Builder sessions always open the pull request as a draft.'
    },
    { name: 'reply_to_thread' },
    { name: 'resolve_thread' },
    { name: 'request_next_round' },
    { name: 'git.push' },
    { name: 'git.pull' },
    { name: 'git.fetch' },
    { name: 'get_review_round' },
    { name: 'pr_status' }
  ],
  assessor: [
    { name: 'review.get_state' },
    { name: 'review.list_actions' },
    {
      name: 'set_pr_draft',
      descriptionNote:
        'Assessor sessions mark the pull request ready for review on a passing assessment and back to draft on a failing one.'
    },
    { name: 'git.fetch' },
    { name: 'get_review_round' },
    { name: 'pr_status' }
  ]
};

export function surfaceForPath(path: string | undefined): McpSurface | null {
  if (path === '/mcp') {
    return unscopedAgentSurface;
  }
  const role = agentRoles.find((candidate) => path === `/mcp/${candidate}`);
  return role === undefined ? null : { kind: 'role', role };
}

export function surfaceLabel(surface: McpSurface): string {
  return surface.kind === 'agent' ? 'agent' : surface.role;
}

function applyGrant(tool: RegisteredTool, grant: RoleGrant, role: AgentRole): RegisteredTool {
  const described: RegisteredTool =
    grant.descriptionNote === undefined ? tool : { ...tool, description: `${tool.description} ${grant.descriptionNote}` };
  if (grant.policy === undefined) {
    return described;
  }
  // The server has already parsed the input with this tool's own schema, which is the
  // input type the grant's policy was written for.
  const policy = grant.policy as (input: unknown, role: AgentRole) => Result<unknown, ToolDomainError>;
  return {
    ...described,
    handler: async (input) => {
      const allowed = policy(input, role);
      if (!allowed.ok) {
        return allowed;
      }
      return tool.handler(allowed.value);
    }
  };
}

export function toolsForSurface(registry: readonly RegisteredTool[], surface: McpSurface): RegisteredTool[] {
  if (surface.kind === 'agent') {
    return registry.filter((tool) => tool.actorScopes.some((scope) => scope === 'agent'));
  }
  return roleGrants[surface.role].flatMap((grant) => {
    const tool = registry.find((candidate) => candidate.name === grant.name);
    return tool === undefined ? [] : [applyGrant(tool, grant, surface.role)];
  });
}
