import { createPrivateKey, createSign } from 'node:crypto';

import { err, ok, type Result } from '#root/src/result.js';
import { createGitHubError, type GitHubError } from '#root/src/github/errors.js';
import type { GitHubAppConfig } from '#root/src/config.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';

export type GitHubInstallationToken = {
  installationId: number;
  token: string;
  expiresAt: Date;
};

export type GitHubAppAuth = {
  mintInstallationToken(installationId: number): Promise<Result<GitHubInstallationToken, GitHubError>>;
};

export type GitHubAppAuthDependencies = {
  fetch?: GitHubFetch;
  now?: () => number;
};

type GitHubInstallationTokenResponse = {
  token: string;
  expires_at: string;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function createJwt(privateKey: ReturnType<typeof createPrivateKey>, appId: number, nowMs: number) {
  const issuedAt = Math.floor(nowMs / 1000) - 30;
  const expiresAt = issuedAt + 9 * 60;

  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iat: issuedAt,
      exp: expiresAt,
      iss: String(appId)
    })
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .end()
    .sign(privateKey)
    .toString('base64url');

  return `${header}.${payload}.${signature}`;
}

function parseTokenResponse(value: unknown): Result<GitHubInstallationTokenResponse, GitHubError> {
  if (typeof value !== 'object' || value === null) {
    return err(
      createGitHubError({
        category: 'authentication',
        operation: 'mint_installation_token',
        requestLabel: 'POST /app/installations/{installation_id}/access_tokens',
        message: 'GitHub returned a non-object installation token response.'
      })
    );
  }

  const token = (value as Record<string, unknown>).token;
  const expiresAt = (value as Record<string, unknown>).expires_at;
  if (typeof token !== 'string' || token.trim() === '') {
    return err(
      createGitHubError({
        category: 'authentication',
        operation: 'mint_installation_token',
        requestLabel: 'POST /app/installations/{installation_id}/access_tokens',
        message: 'GitHub installation token response was missing token.'
      })
    );
  }

  if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) {
    return err(
      createGitHubError({
        category: 'authentication',
        operation: 'mint_installation_token',
        requestLabel: 'POST /app/installations/{installation_id}/access_tokens',
        message: 'GitHub installation token response was missing expires_at.'
      })
    );
  }

  return ok({
    token,
    expires_at: expiresAt
  });
}

async function readSafeResponseMessage(response: Response) {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim() !== '') {
        return message;
      }
    }
  } catch {
    // Ignore parse failures and fall back to the HTTP status text.
  }

  return response.statusText || 'GitHub rejected the request.';
}

export function createGitHubAppAuth(
  config: GitHubAppConfig,
  dependencies: GitHubAppAuthDependencies = {}
): Result<GitHubAppAuth, GitHubError> {
  const fetchFn: GitHubFetch = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;

  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = createPrivateKey({ key: config.privateKey, format: 'pem' });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(
      createGitHubError({
        category: 'configuration',
        operation: 'create_github_app_auth',
        requestLabel: 'private key parsing',
        message: `Unable to parse GitHub App private key: ${detail}`
      })
    );
  }

  return ok({
    async mintInstallationToken(installationId: number) {
      const jwt = createJwt(privateKey, config.appId, now());
      const requestLabel = `POST /app/installations/${installationId}/access_tokens`;
      const url = new URL(`/app/installations/${installationId}/access_tokens`, config.apiBaseUrl);

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
            'User-Agent': 'gated-review',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: '{}'
        });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        return err(
          createGitHubError({
            category: 'transport',
            operation: 'mint_installation_token',
            requestLabel,
            message: `GitHub token request failed: ${detail}`
          })
        );
      }

      if (!response.ok) {
        return err(
          createGitHubError({
            category: 'authentication',
            operation: 'mint_installation_token',
            requestLabel,
            status: response.status,
            message: await readSafeResponseMessage(response)
          })
        );
      }

      let body: unknown;
      try {
        body = (await response.json()) as unknown;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        return err(
          createGitHubError({
            category: 'authentication',
            operation: 'mint_installation_token',
            requestLabel,
            status: response.status,
            message: `GitHub returned an invalid token payload: ${detail}`
          })
        );
      }

      const parsed = parseTokenResponse(body);
      if (!parsed.ok) {
        return parsed;
      }

      return ok({
        installationId,
        token: parsed.value.token,
        expiresAt: new Date(parsed.value.expires_at)
      });
    }
  });
}
