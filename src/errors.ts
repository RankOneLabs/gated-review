export class NotImplementedToolError extends Error {
  readonly code = 'NOT_IMPLEMENTED';
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool "${toolName}" is not implemented yet.`);
    this.name = 'NotImplementedToolError';
    this.toolName = toolName;
  }
}

export function toToolErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown tool error.';
}
