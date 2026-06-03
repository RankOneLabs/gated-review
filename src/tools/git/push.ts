import { z } from 'zod';

import type { Result } from '#root/src/result.js';
import type { ToolDomainError } from '#root/src/errors.js';
import type { ToolContract } from '#root/src/tools/types.js';
import {
  pushGitRepository,
  type GitPushInput,
  type GitPushOutput,
  type GitRunnerDependenciesProvider
} from '#root/src/tools/git/runner.js';
import { getDefaultGitRunnerDependencies } from '#root/src/tools/git/runtime.js';

export const gitPushInputSchema = z
  .object({
    repo_path: z.string().min(1),
    branch: z.string().min(1).optional(),
    force_with_lease: z.boolean().optional()
  })
  .strict()
  .describe('git.push.input');

export const gitPushOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('git.push.output');

export type GitPushContractInput = z.infer<typeof gitPushInputSchema>;
export type GitPushContractOutput = z.infer<typeof gitPushOutputSchema>;

async function runGitPush(
  input: GitPushInput,
  dependenciesProvider: GitRunnerDependenciesProvider
): Promise<Result<GitPushOutput, ToolDomainError>> {
  const dependencies = await dependenciesProvider();
  if (!dependencies.ok) {
    return dependencies;
  }

  return pushGitRepository(input, dependencies.value);
}

export function createGitPushTool(
  dependenciesProvider: GitRunnerDependenciesProvider = getDefaultGitRunnerDependencies
): ToolContract<typeof gitPushInputSchema, typeof gitPushOutputSchema, 'git.push'> {
  return {
    name: 'git.push',
    title: 'Git Push',
    description: 'Push the current or requested branch to the origin remote via the MCP server.',
    actorScopes: ['agent', 'operator'],
    inputSchemaName: 'git.push.input',
    outputSchemaName: 'git.push.output',
    inputSchema: gitPushInputSchema,
    outputSchema: gitPushOutputSchema,
    handler: async (input) => {
      return runGitPush(input, dependenciesProvider);
    }
  };
}

export const gitPushTool = createGitPushTool();
