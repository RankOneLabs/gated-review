import { describe, expect, it } from 'vitest';

import { makeRepoPrKey, parseRepoSlug } from '#root/src/tools/repository-ref.js';

describe('parseRepoSlug', () => {
  describe('valid slugs', () => {
    it('parses a valid owner/name slug', () => {
      const result = parseRepoSlug('owner/name');
      expect(result).toEqual({ ok: true, value: { owner: 'owner', repo: 'name' } });
    });

    it('trims surrounding whitespace', () => {
      const result = parseRepoSlug('  owner/name  ');
      expect(result).toEqual({ ok: true, value: { owner: 'owner', repo: 'name' } });
    });
  });

  describe('invalid slugs', () => {
    it('returns error for empty input', () => {
      const result = parseRepoSlug('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_repository_slug');
        expect(result.error.operation).toBe('parse_repo_slug');
      }
    });

    it('returns error for blank input', () => {
      const result = parseRepoSlug('   ');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_repository_slug');
      }
    });

    it('returns error for single segment (no slash)', () => {
      const result = parseRepoSlug('owner');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_repository_slug');
      }
    });

    it('returns error for three segments', () => {
      const result = parseRepoSlug('owner/name/extra');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_repository_slug');
      }
    });

    it('returns error for empty owner segment', () => {
      const result = parseRepoSlug('/name');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_repository_slug');
      }
    });

    it('returns error for empty repo segment', () => {
      const result = parseRepoSlug('owner/');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_repository_slug');
      }
    });
  });
});

describe('makeRepoPrKey', () => {
  it('produces owner/repo#pr format', () => {
    const key = makeRepoPrKey({ owner: 'acme', repo: 'app' }, 42);
    expect(key).toBe('acme/app#42');
  });
});
