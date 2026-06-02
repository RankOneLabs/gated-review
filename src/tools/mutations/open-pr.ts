import { z } from 'zod';

import { githubError, type ToolDomainError } from '#root/src/errors.js';
import type { GitHubError } from '#root/src/github/errors.js';
import { err, ok, type Result } from '#root/src/result.js';
import type { ToolExecutionContext } from '#root/src/tools/context.js';
import { resolveRepositoryScopeFromContext } from '#root/src/tools/mutations/repository.js';

export const openPrInputSchema = z
  .object({
    base: z.string().min(1),
    head: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1).optional(),
    draft: z.boolean().optional()
  })
  .strict()
  .describe('open_pr.input');

export const openPrOutputSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.string().url(),
    state: z.string().min(1)
  })
  .strict()
  .describe('open_pr.output');

export type OpenPrInput = z.infer<typeof openPrInputSchema>;
export type OpenPrOutput = z.infer<typeof openPrOutputSchema>;

function mapGitHubError(operation: string, error: GitHubError): ToolDomainError {
  const statusSuffix = error.status === undefined ? '' : ` status=${error.status}`;
  return githubError(operation, `${error.category}: ${error.message} (${error.requestLabel}${statusSuffix})`);
}

export function createOpenPrHandler(context: ToolExecutionContext) {
  return async function openPr(input: unknown): Promise<Result<OpenPrOutput, ToolDomainError>> {
    const parsedInput = openPrInputSchema.parse(input);
    const result = await context.github.rest.createPullRequest(
      resolveRepositoryScopeFromContext(context),
      {
        title: parsedInput.title,
        head: parsedInput.head,
        base: parsedInput.base,
        ...(parsedInput.body === undefined ? {} : { body: parsedInput.body }),
        ...(parsedInput.draft === undefined ? {} : { draft: parsedInput.draft })
      }
    );

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
