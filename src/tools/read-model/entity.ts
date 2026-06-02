import type { ReadModelEntity, ReadModelEntityKind } from '#root/src/tools/read-model/types.js';

const codeRabbitBotLogins = new Set(['coderabbitai[bot]']);

const copilotBotLogins = new Set([
  'copilot[bot]',
  'github-copilot[bot]',
  'copilot-swe-agent[bot]',
  'copilot-code-reviewer[bot]',
  'copilot-reviewer[bot]'
]);

export function classifyAuthorLogin(login: string): ReadModelEntityKind {
  const normalizedLogin = login.trim().toLowerCase();

  if (codeRabbitBotLogins.has(normalizedLogin)) {
    return 'coderabbit';
  }

  if (copilotBotLogins.has(normalizedLogin)) {
    return 'copilot';
  }

  return 'human';
}

export function tagEntity(login: string): ReadModelEntity {
  return {
    login,
    kind: classifyAuthorLogin(login)
  };
}
