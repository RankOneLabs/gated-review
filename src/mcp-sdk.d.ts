declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  export type RegisterToolOptions = Readonly<{
    title: string;
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
  }>;

  export type ToolResult = Readonly<{
    content: ReadonlyArray<Readonly<{ type: 'text'; text: string }>>;
    isError?: boolean;
    structuredContent?: unknown;
  }>;

  export class McpServer {
    constructor(options: Readonly<{ name: string; version: string }>);
    registerTool(
      name: string,
      options: RegisterToolOptions,
      handler: (input: unknown) => Promise<ToolResult> | ToolResult
    ): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {}
}
