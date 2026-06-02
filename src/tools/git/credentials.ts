function normalizeGitHubHost(hostOrUrl: string) {
  const trimmed = hostOrUrl.trim();
  if (trimmed === '') {
    throw new Error('GitHub host must not be empty.');
  }

  if (trimmed.includes('://')) {
    return new URL(trimmed).host;
  }

  return trimmed.replace(/\/.*$/, '');
}

function encodeBasicAuth(token: string) {
  return Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
}

export function createGitHubExtraHeader(hostOrUrl: string, token: string) {
  const host = normalizeGitHubHost(hostOrUrl);
  return `http.https://${host}/.extraheader=AUTHORIZATION: basic ${encodeBasicAuth(token)}`;
}

export function redactGitHubExtraHeader(value: string, token: string) {
  const encodedToken = encodeBasicAuth(token);
  return value
    .replaceAll(token, '[redacted]')
    .replaceAll(encodedToken, '[redacted]')
    .replace(/AUTHORIZATION: basic [A-Za-z0-9+/=]+/g, 'AUTHORIZATION: basic [redacted]');
}
