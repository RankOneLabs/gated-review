export async function readGitHubErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim() !== '') {
        return message;
      }
    }
  } catch {
    // Fall back to the HTTP status text below.
  }

  return response.statusText || 'GitHub rejected the request.';
}
