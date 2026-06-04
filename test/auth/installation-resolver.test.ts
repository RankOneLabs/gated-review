import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createGitHubAppAuth } from '#root/src/auth/github-app.js';
import {
  GitHubInstallationResolver,
  fixedInstallationResolver
} from '#root/src/auth/installation-resolver.js';
import type { GitHubAppConfig } from '#root/src/config.js';
import type { GitHubFetch } from '#root/src/github/fetch.js';

function appConfig(): GitHubAppConfig {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    appId: 123,
    installationId: 456,
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs1' }).toString(),
    apiBaseUrl: 'https://api.github.com',
    graphqlUrl: 'https://api.github.com/graphql',
    copilotReviewerLogin: 'copilot[bot]',
    httpPort: 3000
  };
}

function installationByOwner(idsByOwner: Record<string, number>): {
  fetch: GitHubFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetch: GitHubFetch = async (input) => {
    const url = String(input);
    urls.push(url);
    const match = url.match(/\/repos\/([^/]+)\/[^/]+\/installation$/);
    const owner = (match?.[1] ?? '').toLowerCase();
    const id = idsByOwner[owner];
    if (id === undefined) {
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  return { fetch, urls };
}

describe('installation lookup + resolver', () => {
  it('looks up the installation id for a repo owner via the App JWT', async () => {
    const { fetch, urls } = installationByOwner({ cirsteve: 111 });
    const auth = createGitHubAppAuth(appConfig(), { fetch, now: () => 1_000_000 });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const result = await auth.value.lookupInstallationId('cirsteve', 'foo');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(111);
    expect(urls).toEqual(['https://api.github.com/repos/cirsteve/foo/installation']);
  });

  it('returns a clear error when the App is not installed on the owner', async () => {
    const { fetch } = installationByOwner({ cirsteve: 111 });
    const auth = createGitHubAppAuth(appConfig(), { fetch, now: () => 1_000_000 });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const result = await auth.value.lookupInstallationId('RankOneLabs', 'bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(404);
      expect(result.error.message).toContain('not installed on RankOneLabs');
    }
  });

  it('routes two owners to two distinct installations and caches per owner', async () => {
    const { fetch, urls } = installationByOwner({ cirsteve: 111, rankonelabs: 222 });
    const auth = createGitHubAppAuth(appConfig(), { fetch, now: () => 1_000_000 });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const resolver = new GitHubInstallationResolver(auth.value);

    const a1 = await resolver.resolveInstallationId('cirsteve', 'foo');
    const a2 = await resolver.resolveInstallationId('cirsteve', 'other-repo');
    const b1 = await resolver.resolveInstallationId('RankOneLabs', 'bar');

    expect(a1.ok && a1.value).toBe(111);
    expect(a2.ok && a2.value).toBe(111);
    expect(b1.ok && b1.value).toBe(222);

    // cirsteve looked up once (cached for the second repo); RankOneLabs once.
    expect(urls).toEqual([
      'https://api.github.com/repos/cirsteve/foo/installation',
      'https://api.github.com/repos/RankOneLabs/bar/installation'
    ]);
  });

  it('fixedInstallationResolver always returns the configured id', async () => {
    const resolver = fixedInstallationResolver(789);
    const result = await resolver.resolveInstallationId('anyone', 'anything');
    expect(result.ok && result.value).toBe(789);
  });
});
