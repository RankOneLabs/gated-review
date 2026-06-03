import { z } from 'zod';

import type { Result } from '#root/src/result.js';
import type { ToolDomainError } from '#root/src/errors.js';
import type { ToolContract } from '#root/src/tools/types.js';
import {
  fetchGitRepository,
  type GitFetchInput,
  type GitFetchOutput,
  type GitRunnerDependenciesProvider
} from '#root/src/tools/git/runner.js';
import { getDefaultGitRunnerDependencies } from '#root/src/tools/git/runtime.js';

export const gitFetchInputSchema = z
  .object({
    repository: z.string().min(1),
    repo_path: z.string().min(1),
    refspec: z.string().min(1).optional()
  })
  .strict()
  .describe('git.fetch.input');

export const gitFetchOutputSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()
  .describe('git.fetch.output');

export type GitFetchContractInput = z.infer<typeof gitFetchInputSchema>;
export type GitFetchContractOutput = z.infer<typeof gitFetchOutputSchema>;

async function runGitFetch(
  input: GitFetchInput,
  dependenciesProvider: GitRunnerDependenciesProvider
): Promise<Result<GitFetchOutput, ToolDomainError>> {
  const dependencies = await dependenciesProvider();
  if (!dependencies.ok) {
    return dependencies;
  }

  return fetchGitRepository(input, dependencies.value);
}

export function createGitFetchTool(
  dependenciesProvider: GitRunnerDependenciesProvider = getDefaultGitRunnerDependencies
): ToolContract<typeof gitFetchInputSchema, typeof gitFetchOutputSchema, 'git.fetch'> {
  return {
    name: 'git.fetch',
    title: 'Git Fetch',
    description: 'Fetch a refspec from origin through the server (remote credentials stay server-side). Do NOT use git push/pull/fetch in the shell or gh for remote operations. Requires repository as an owner/name slug.',
    actorScopes: ['agent', 'operator'],
    inputSchemaName: 'git.fetch.input',
    outputSchemaName: 'git.fetch.output',
    inputSchema: gitFetchInputSchema,
    outputSchema: gitFetchOutputSchema,
    handler: async (input) => {
      return runGitFetch(input, dependenciesProvider);
    }
  };
}

export const gitFetchTool = createGitFetchTool();
