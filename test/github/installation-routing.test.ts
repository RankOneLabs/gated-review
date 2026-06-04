import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createGitHubClient } from '#root/src/github/client.js';
import type { GitHubAppConfig } from '#root/src/config.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';

/**
 * Proves multi-account routing end to end: with no fixed installation id the
 * client discovers the installation per repository owner, so requests against
 * two different owners are authenticated with two different installation tokens.
 */
function multiAccountConfig(): GitHubAppConfig {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    appId: 123,
    // No installationId -> dynamic discovery mode.
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs1' }).toString(),
    apiBaseUrl: 'https://api.github.com',
    graphqlUrl: 'https://api.github.com/graphql',
    copilotReviewerLogin: 'copilot[bot]',
    httpPort: 3000
  };
}

describe('multi-account installation routing', () => {
  it('mints a distinct installation token per repository owner', async () => {
    const installationIdByOwner: Record<string, number> = { cirsteve: 111, rankonelabs: 222 };
    // Records the Authorization token used on each create-PR call, keyed by owner.
    const authByOwner: Record<string, string> = {};

    const fetch: GitHubFetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      const installationLookup = url.match(/\/repos\/([^/]+)\/[^/]+\/installation$/);
      if (installationLookup) {
        const owner = installationLookup[1].toLowerCase();
        const id = installationIdByOwner[owner];
        return new Response(JSON.stringify({ id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const tokenMint = url.match(/\/app\/installations\/(\d+)\/access_tokens$/);
      if (tokenMint) {
        const id = tokenMint[1];
        return new Response(
          JSON.stringify({ token: `token-for-${id}`, expires_at: '2999-01-01T00:00:00.000Z' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const createPr = url.match(/\/repos\/([^/]+)\/[^/]+\/pulls$/);
      if (createPr) {
        const owner = createPr[1].toLowerCase();
        authByOwner[owner] = headers.get('Authorization') ?? '';
        return new Response(
          JSON.stringify({ number: 1, html_url: `${url}/1`, state: 'open' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`unexpected request: ${url}`);
    };

    const client = createGitHubClient(multiAccountConfig(), { fetch, now: () => 1_000_000 });
    expect(client.ok).toBe(true);
    if (!client.ok) return;

    const prInput = { title: 't', head: 'feature', base: 'main' };
    const a = await client.value.rest.createPullRequest({ owner: 'cirsteve', repo: 'foo' }, prInput);
    const b = await client.value.rest.createPullRequest({ owner: 'RankOneLabs', repo: 'bar' }, prInput);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    // cirsteve -> installation 111, RankOneLabs -> installation 222: distinct tokens.
    expect(authByOwner.cirsteve).toBe('Bearer token-for-111');
    expect(authByOwner.rankonelabs).toBe('Bearer token-for-222');
  });
});
