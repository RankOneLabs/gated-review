import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { toToolErrorMessage } from './errors.js';
import { toolRegistry } from './tools/registry.js';

export function createServer() {
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
        try {
          const output = await tool.handler(tool.inputSchema.parse(input));
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output) }],
            structuredContent: output
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: toToolErrorMessage(error) }],
            isError: true
          };
        }
      }
    );
  }

  return server;
}

export async function runStdioServer() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
