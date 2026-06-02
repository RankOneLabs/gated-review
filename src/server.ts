import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { describeToolError, validationRejectedError } from '#root/src/errors.js';
import { isOk } from '#root/src/result.js';
import { loadToolExecutionContext, type ToolExecutionContext } from '#root/src/tools/context.js';
import { toolRegistry } from '#root/src/tools/registry.js';

export function createServer(context: ToolExecutionContext) {
  const server = new McpServer({
    name: 'gated-review',
    version: '0.1.0'
  });

  for (const tool of toolRegistry) {
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

        const outcome = await tool.handler(parsedInput.data, context);
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
  const context = await loadToolExecutionContext();
  const server = createServer(context);
  await server.connect(new StdioServerTransport());
}
