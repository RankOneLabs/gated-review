import { z } from 'zod';

import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import type { GitHubRepositoryScope } from '#root/src/github/rest.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';

export const openPrInputSchema = z
  .object({
    base: z.string().min(1),
    head: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1).optional(),
    draft: z.boolean().optional()
  })
  .strict()
  .describe('github.open_pr.input');

export const openPrOutputSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.string().url(),
    state: z.string().min(1)
  })
  .strict()
  .describe('github.open_pr.output');

export type OpenPrInput = z.infer<typeof openPrInputSchema>;
export type OpenPrOutput = z.infer<typeof openPrOutputSchema>;

function mapGitHubError(operation: string, error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(operation, `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

function resolveRepository(context: ToolExecutionContext): GitHubRepositoryScope {
  return context.repository;
}

export function createOpenPrHandler(context: ToolExecutionContext) {
  return async function openPr(input: OpenPrInput): Promise<Result<OpenPrOutput, ToolDomainError>> {
    const result = await context.github.rest.createPullRequest(resolveRepository(context), {
      title: input.title,
      head: input.head,
      base: input.base,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.draft === undefined ? {} : { draft: input.draft })
    });

    if (!result.ok) {
      return err(mapGitHubError('open_pr', result.error));
    }

    return ok({
      number: result.value.number,
      url: result.value.html_url,
      state: result.value.state
    });
  };
}
