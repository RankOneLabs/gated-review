import { describe, expect, it } from 'vitest';

import { classifyAuthorLogin, tagEntity } from '#root/src/tools/read-model/entity.js';

describe('read model entity tagging', () => {
  it('tags CodeRabbit and Copilot bot logins on the server side', () => {
    expect(classifyAuthorLogin('coderabbitai[bot]')).toBe('coderabbit');
    expect(classifyAuthorLogin('github-copilot[bot]')).toBe('copilot');
    expect(classifyAuthorLogin('alice')).toBe('human');
  });

  it('preserves the raw login alongside the entity kind', () => {
    expect(tagEntity('Copilot[bot]')).toEqual({
      login: 'Copilot[bot]',
      kind: 'copilot'
    });
  });
});
