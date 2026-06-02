import { describe, expect, it } from 'vitest';

import { createGitHubExtraHeader, redactGitHubExtraHeader } from '#root/src/tools/git/credentials.js';
import { validateGitBranchName, validateGitRefspec } from '#root/src/tools/git/validation.js';

describe('git validation helpers', () => {
  it('accepts safe branch names and rejects unsafe ones', () => {
    expect(validateGitBranchName('feature/remote-gateway', 'git.push')).toEqual({
      ok: true,
      value: 'feature/remote-gateway'
    });

    expect(validateGitBranchName('-refs/heads/main', 'git.push')).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'validation_rejected',
        operation: 'git.push'
      })
    });

    expect(validateGitBranchName(' feature/remote-gateway', 'git.push')).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'validation_rejected',
        operation: 'git.push'
      })
    });

    expect(validateGitBranchName('feature;rm -rf', 'git.push')).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'validation_rejected',
        operation: 'git.push'
      })
    });
  });

  it('accepts conservative refspecs and rejects shell metacharacters', () => {
    expect(validateGitRefspec('refs/heads/main:refs/remotes/origin/main', 'git.fetch')).toEqual({
      ok: true,
      value: 'refs/heads/main:refs/remotes/origin/main'
    });

    expect(validateGitRefspec('+refs/heads/main', 'git.fetch')).toEqual({
      ok: true,
      value: '+refs/heads/main'
    });

    expect(validateGitRefspec('refs/heads/main:*', 'git.fetch')).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'validation_rejected',
        operation: 'git.fetch'
      })
    });

    expect(validateGitRefspec('', 'git.fetch')).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'validation_rejected',
        operation: 'git.fetch'
      })
    });
  });

  it('builds a per-command GitHub extraheader and redacts it for logs', () => {
    const header = createGitHubExtraHeader('https://github.com', 'token-123');
    expect(header).toBe(
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
        'x-access-token:token-123',
        'utf8'
      ).toString('base64')}`
    );

    expect(redactGitHubExtraHeader(`command failed: ${header}`, 'token-123')).toContain(
      'AUTHORIZATION: basic [redacted]'
    );
    expect(redactGitHubExtraHeader(`token-123`, 'token-123')).toBe('[redacted]');
  });
});
