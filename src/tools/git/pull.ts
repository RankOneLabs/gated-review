import { z } from 'zod';

import type { Result } from '#root/src/result.js';
import type { ToolDomainError } from '#root/src/errors.js';
import type { ToolContract } from '#root/src/tools/types.js';
import {
  pullGitRepository,
  type GitPullInput,
  type GitPullOutput,
  type GitRunnerDependenciesProvider
} from '#root/src/tools/git/runner.js';
import { getDefaultGitRunnerDependencies } from '#root/src/tools/git/runtime.js';
import { repositorySlugSchema } from '#root/src/tools/repository-ref.js';

export const gitPullInputSchema = z
  .object({
    repository: repositorySlugSchema,
    repo_path: z.string().min(1),
    branch: z.string().min(1).optional(),
    rebase: z.boolean().optional()
  })
  .strict()
  .describe('git.pull.input');

export const gitPullOutputSchema = z
  .object({
    ok: z.literal(true),
    head_sha: z.string().min(1)
  })
  .strict()
  .describe('git.pull.output');

export type GitPullContractInput = z.infer<typeof gitPullInputSchema>;
export type GitPullContractOutput = z.infer<typeof gitPullOutputSchema>;

async function runGitPull(
  input: GitPullInput,
  dependenciesProvider: GitRunnerDependenciesProvider
): Promise<Result<GitPullOutput, ToolDomainError>> {
  const dependencies = await dependenciesProvider();
  if (!dependencies.ok) {
    return dependencies;
  }

  return pullGitRepository(input, dependencies.value);
}

export function createGitPullTool(
  dependenciesProvider: GitRunnerDependenciesProvider = getDefaultGitRunnerDependencies
): ToolContract<typeof gitPullInputSchema, typeof gitPullOutputSchema, 'git.pull'> {
  return {
    name: 'git.pull',
    title: 'Git Pull',
    description: 'Pull a branch from origin through the server (remote credentials stay server-side). Do NOT use git push/pull/fetch in the shell or GitHub CLI (gh) for remote operations. Requires repository as an owner/name slug.',
    actorScopes: ['agent', 'operator'],
    inputSchemaName: 'git.pull.input',
    outputSchemaName: 'git.pull.output',
    inputSchema: gitPullInputSchema,
    outputSchema: gitPullOutputSchema,
    handler: async (input) => {
      return runGitPull(input, dependenciesProvider);
    }
  };
}

export const gitPullTool = createGitPullTool();
