import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createGitHubClient } from '#root/src/github/client.js';
import { loadGitHubAppConfig } from '#root/src/config.js';
import { describeToolError, validationRejectedError } from '#root/src/errors.js';
import { isOk } from '#root/src/result.js';
import { createToolRegistry } from '#root/src/tools/registry.js';
import { createToolExecutionContext, type ToolExecutionContext } from '#root/src/tools/context.js';
import { createInMemoryFreshnessStore } from '#root/src/tools/freshness-store.js';
import { reviewDecisionOutputSchema } from '#root/src/tools/schemas.js';
import type { ZodTypeAny } from 'zod';

import type { ToolContract } from '#root/src/tools/types.js';

function createToolHandler(tool: ToolContract<ZodTypeAny, ZodTypeAny, string>) {
  return async (input: unknown) => {
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

    const outcome = await tool.handler(parsedInput.data);
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
  };
}

export function createServer(context: ToolExecutionContext) {
  const server = new McpServer({
    name: 'gated-review',
    version: '0.1.0'
  });

  const agentTools = createToolRegistry(context).filter((tool) =>
    tool.actorScopes.some((scope) => scope === 'agent')
  );

  const agentToolNames = agentTools.map((tool) => tool.name);
  console.info('[gated-review] server.start', {
    operation: 'server.start',
    detail: `agent tools: ${agentToolNames.join(', ')}`
  });

  for (const tool of agentTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      },
      createToolHandler(tool)
    );
  }

  return server;
}

export async function runHttpServer() {
  const configResult = await loadGitHubAppConfig();
  if (!configResult.ok) {
    throw new Error(configResult.error.detail);
  }

  const githubClientResult = createGitHubClient(configResult.value);
  if (!githubClientResult.ok) {
    throw new Error(githubClientResult.error.message);
  }

  const context = createToolExecutionContext(
    githubClientResult.value,
    configResult.value.copilotReviewerLogin,
    createInMemoryFreshnessStore()
  );

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    try {
      if (req.url !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const sessionId = req.headers['mcp-session-id'];

      if (typeof sessionId === 'string' && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res);
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        }
      });

      const server = createServer(context);
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[gated-review] request error', { detail: message });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  const { httpPort } = configResult.value;

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(httpPort, () => {
      console.info('[gated-review] server.listen', {
        operation: 'server.listen',
        detail: `HTTP MCP server listening on port ${httpPort}`
      });
      resolve();
    });
  });

  return httpServer;
}
