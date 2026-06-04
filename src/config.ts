import { readFile } from 'node:fs/promises';

import { err, ok, type Result } from '#root/src/result.js';

export type GitHubAppConfig = {
  appId: number;
  /**
   * Fixed installation id. When set, every request uses this single installation
   * (legacy single-account mode). When omitted, the server discovers the
   * installation per repository owner, letting one deployment serve repos across
   * multiple accounts.
   */
  installationId?: number;
  privateKey: string;
  apiBaseUrl: string;
  graphqlUrl: string;
  copilotReviewerLogin: string;
  httpPort: number;
};

export type GitHubConfigError =
  | {
      kind: 'missing_configuration';
      operation: 'load_github_app_config';
      detail: string;
    }
  | {
      kind: 'invalid_configuration';
      operation: 'load_github_app_config';
      detail: string;
    }
  | {
      kind: 'configuration_io_error';
      operation: 'load_github_app_config';
      detail: string;
    };

export type GitHubConfigEnvironment = Readonly<Record<string, string | undefined>>;

const defaultApiBaseUrl = 'https://api.github.com';
const defaultGraphqlUrl = 'https://api.github.com/graphql';
const defaultCopilotReviewerLogin = 'copilot[bot]';

function parsePositiveInteger(value: string | undefined, variableName: string, max?: number) {
  if (value === undefined || value.trim() === '') {
    return err<number, GitHubConfigError>({
      kind: 'missing_configuration',
      operation: 'load_github_app_config',
      detail: `${variableName} is required.`
    });
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return err<number, GitHubConfigError>({
      kind: 'invalid_configuration',
      operation: 'load_github_app_config',
      detail: `${variableName} must be a positive integer.`
    });
  }

  if (max !== undefined && parsed > max) {
    return err<number, GitHubConfigError>({
      kind: 'invalid_configuration',
      operation: 'load_github_app_config',
      detail: `${variableName} must be between 1 and ${max}.`
    });
  }

  return ok(parsed);
}

function parseOptionalPositiveInteger(value: string | undefined, variableName: string) {
  if (value === undefined || value.trim() === '') {
    return ok<number | undefined, GitHubConfigError>(undefined);
  }

  const parsed = parsePositiveInteger(value, variableName);
  if (!parsed.ok) {
    return parsed;
  }

  return ok<number | undefined, GitHubConfigError>(parsed.value);
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, '\n');
}

function normalizeUrl(value: string | undefined, fallback: string, variableName: string) {
  if (value === undefined || value.trim() === '') {
    return ok(fallback);
  }

  try {
    return ok(new URL(value).toString().replace(/\/$/, ''));
  } catch {
    return err<string, GitHubConfigError>({
      kind: 'invalid_configuration',
      operation: 'load_github_app_config',
      detail: `${variableName} must be a valid URL.`
    });
  }
}

function normalizeCopilotReviewerLogin(value: string | undefined) {
  if (value === undefined || value.trim() === '') {
    return ok(defaultCopilotReviewerLogin);
  }

  const normalized = value.trim();
  if (normalized.includes('\n') || normalized.includes('\r')) {
    return err<string, GitHubConfigError>({
      kind: 'invalid_configuration',
      operation: 'load_github_app_config',
      detail: 'GITHUB_COPILOT_REVIEWER_LOGIN must be a single-line login.'
    });
  }

  return ok(normalized);
}

async function loadPrivateKey(env: GitHubConfigEnvironment) {
  const inlinePrivateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (inlinePrivateKey !== undefined && inlinePrivateKey.trim() !== '') {
    return ok(normalizePrivateKey(inlinePrivateKey));
  }

  const privateKeyPath = env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (privateKeyPath === undefined || privateKeyPath.trim() === '') {
    return err<string, GitHubConfigError>({
      kind: 'missing_configuration',
      operation: 'load_github_app_config',
      detail: 'Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH.'
    });
  }

  try {
    const fileContents = await readFile(privateKeyPath, 'utf8');
    return ok(fileContents);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err<string, GitHubConfigError>({
      kind: 'configuration_io_error',
      operation: 'load_github_app_config',
      detail: `Unable to read GITHUB_APP_PRIVATE_KEY_PATH: ${detail}`
    });
  }
}

export async function loadGitHubAppConfig(
  env: GitHubConfigEnvironment = process.env
): Promise<Result<GitHubAppConfig, GitHubConfigError>> {
  const appId = parsePositiveInteger(env.GITHUB_APP_ID, 'GITHUB_APP_ID');
  if (!appId.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(appId.error);
  }

  const installationId = parseOptionalPositiveInteger(
    env.GITHUB_APP_INSTALLATION_ID,
    'GITHUB_APP_INSTALLATION_ID'
  );
  if (!installationId.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(installationId.error);
  }

  const privateKey = await loadPrivateKey(env);
  if (!privateKey.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(privateKey.error);
  }

  const apiBaseUrl = normalizeUrl(env.GITHUB_API_BASE_URL, defaultApiBaseUrl, 'GITHUB_API_BASE_URL');
  if (!apiBaseUrl.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(apiBaseUrl.error);
  }

  const graphqlUrl = normalizeUrl(env.GITHUB_GRAPHQL_URL, defaultGraphqlUrl, 'GITHUB_GRAPHQL_URL');
  if (!graphqlUrl.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(graphqlUrl.error);
  }

  const copilotReviewerLogin = normalizeCopilotReviewerLogin(env.GITHUB_COPILOT_REVIEWER_LOGIN);
  if (!copilotReviewerLogin.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(copilotReviewerLogin.error);
  }

  const httpPort = parsePositiveInteger(env.GATED_REVIEW_HTTP_PORT, 'GATED_REVIEW_HTTP_PORT', 65535);
  if (!httpPort.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(httpPort.error);
  }

  return ok({
    appId: appId.value,
    installationId: installationId.value,
    privateKey: privateKey.value,
    apiBaseUrl: apiBaseUrl.value,
    graphqlUrl: graphqlUrl.value,
    copilotReviewerLogin: copilotReviewerLogin.value,
    httpPort: httpPort.value
  });
}
