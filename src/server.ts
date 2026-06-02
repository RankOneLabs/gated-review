import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createGitHubClient } from '#root/src/github/client.js';
import { loadGitHubAppConfig } from '#root/src/config.js';
import { describeToolError, validationRejectedError } from '#root/src/errors.js';
import { isOk } from '#root/src/result.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import { createToolExecutionContext } from '#root/src/tools/context.js';
import { resolveRepositoryScope } from '#root/src/tools/mutations/repository.js';
import { reviewDecisionOutputSchema } from '#root/src/tools/schemas.js';

export function createServer(context: import('#root/src/tools/context.js').ToolExecutionContext) {
  const server = new McpServer({
    name: 'gated-review',
    version: '0.1.0'
  });

  for (const tool of createToolRegistry(context)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      },
      async (input: unknown) => {
        const parsedInput = tool.inputSchema.safeParse(input);
        if (!parsedInput.success) {
          const rejection = validationRejectedError(tool.name, parsedInput.error.message);
          console.warn('[gated-review] tool rejection', {
            operation: rejection.operation,
            entity: rejection.entity,
            detail: rejection.detail
          });
          return {
            content: [{ type: 'text' as const, text: describeToolError(rejection) }],
            isError: true
          };
        }

        const outcome = (await tool.handler(parsedInput.data)) as
          | { ok: true; value: unknown }
          | { ok: false; error: import('#root/src/errors.js').ToolDomainError };
        if (isOk(outcome)) {
          const parsedOutput = tool.outputSchema.safeParse(outcome.value);
          if (!parsedOutput.success) {
            const rejection = validationRejectedError(tool.name, parsedOutput.error.message);
            console.warn('[gated-review] tool rejection', {
              operation: rejection.operation,
              entity: rejection.entity,
              detail: rejection.detail
            });
            return {
              content: [{ type: 'text' as const, text: describeToolError(rejection) }],
              isError: true
            };
          }

          if (tool.name === 'review.apply_decision') {
            const decisionOutput = reviewDecisionOutputSchema.parse(parsedOutput.data);
            console.info('[gated-review] tool decision', {
              operation: tool.name,
              entity: { kind: 'tool', name: tool.name },
              detail: `decision ${decisionOutput.decisionId} -> ${decisionOutput.finalStatus}`
            });
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(parsedOutput.data) }],
            structuredContent: parsedOutput.data
          };
        }

        console.warn('[gated-review] tool rejection', {
          operation: outcome.error.operation,
          entity: outcome.error.entity,
          detail: outcome.error.detail
        });
        return {
          content: [{ type: 'text' as const, text: describeToolError(outcome.error) }],
          isError: true
        };
      }
    );
  }

  return server;
}

export async function runStdioServer() {
  const configResult = await loadGitHubAppConfig();
  if (!configResult.ok) {
    throw new Error(configResult.error.detail);
  }

  const githubClientResult = createGitHubClient(configResult.value);
  if (!githubClientResult.ok) {
    throw new Error(githubClientResult.error.message);
  }

  const repositoryResult = await resolveRepositoryScope();
  if (!repositoryResult.ok) {
    throw new Error(repositoryResult.error.detail);
  }

  const context = createToolExecutionContext(githubClientResult.value, repositoryResult.value);
  const server = createServer(context);
  await server.connect(new StdioServerTransport());
}
