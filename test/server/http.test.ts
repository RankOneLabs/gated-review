import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createServer } from '#root/src/server.js';
import { createToolExecutionContext } from '#root/src/tools/context.js';
import { createGitHubGraphQLClient } from '#root/src/github/graphql.js';
import { createGitHubRestClient } from '#root/src/github/rest.js';
import { ok } from '#root/src/result.js';
import type { GitHubInstallationTokenProvider } from '#root/src/auth/token-cache.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

function createStubContext() {
  const tokenProvider: GitHubInstallationTokenProvider = {
    async getInstallationToken() {
      return ok('stub-token');
    }
  };

  const rest = createGitHubRestClient(
    { baseUrl: 'https://api.github.com', installationId: 99, tokenProvider },
    {
      fetch: async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    }
  );

  const graphql = createGitHubGraphQLClient(
    { graphqlUrl: 'https://api.github.com/graphql', installationId: 99, tokenProvider },
    {
      fetch: async () =>
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    }
  );

  return createToolExecutionContext(
    {
      installationId: 99,
      apiBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      graphql,
      rest
    },
    'copilot[bot]'
  );
}

function buildHttpServer(sessions: Map<string, StreamableHTTPServerTransport>) {
  const context = createStubContext();

  return createHttpServer(async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];

      if (typeof sessionId === 'string' && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res);
        return;
      }

      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
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
    } catch {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
  });
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.1' }
  }
});

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream'
} as const;

/**
 * Extracts the JSON-RPC payload from a Streamable HTTP response body. The
 * transport may answer a request whose `Accept` allows both `application/json`
 * and `text/event-stream` with either framing, so parse a plain JSON body
 * directly and fall back to SSE framing when `data:` lines are present. Per the
 * SSE spec an event may carry multiple `data:` lines that reconstruct the
 * payload when joined with `\n`, so collect every `data:` line of the first
 * event rather than only the first line.
 */
function parseSseMessage(body: string): unknown {
  const event = body
    .split(/\r?\n\r?\n/)
    .find((chunk) => chunk.split(/\r?\n/).some((line) => line.startsWith('data:')));
  if (event === undefined) {
    return JSON.parse(body);
  }
  const payload = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n');
  return JSON.parse(payload);
}

describe('HTTP MCP server startup', () => {
  it('binds to a port and handles an MCP initialize request', async () => {
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const httpServer = buildHttpServer(sessions);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        },
        body: initBody
      });

      expect(response.status).toBe(200);
      await response.body?.cancel();
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it('serves two concurrent sessions independently', async () => {
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const httpServer = buildHttpServer(sessions);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;

    try {
      const [r1, r2] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream'
          },
          body: initBody
        }),
        fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream'
          },
          body: initBody
        })
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(sessions.size).toBe(2);
      await r1.body?.cancel();
      await r2.body?.cancel();
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  // Regression: every tool's input and output schema must be representable in
  // JSON Schema, because the SDK serializes them all when answering tools/list.
  // A `.transform()` in any schema made this call fail with JSON-RPC -32603
  // "Transforms cannot be represented in JSON Schema", leaving clients unable to
  // discover any tool even though `initialize` succeeded.
  it('answers tools/list with serializable schemas for every tool', async () => {
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const httpServer = buildHttpServer(sessions);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/mcp`;

    try {
      const initResponse = await fetch(url, { method: 'POST', headers: MCP_HEADERS, body: initBody });
      expect(initResponse.status).toBe(200);
      const sessionId = initResponse.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();
      await initResponse.body?.cancel();

      const sessionHeaders = { ...MCP_HEADERS, 'mcp-session-id': sessionId as string };

      const initializedResponse = await fetch(url, {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      });
      expect(initializedResponse.status).toBe(202);
      await initializedResponse.body?.cancel();

      const listResponse = await fetch(url, {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      });
      expect(listResponse.status).toBe(200);

      const message = parseSseMessage(await listResponse.text()) as {
        error?: { message: string };
        result?: { tools: Array<{ name: string }> };
      };

      expect(message.error).toBeUndefined();
      expect(message.result?.tools.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });
});
