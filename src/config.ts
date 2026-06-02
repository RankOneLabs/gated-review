import { readFile } from 'node:fs/promises';

import { err, ok, type Result } from '#root/src/result.js';

export type GitHubAppConfig = {
  appId: number;
  installationId: number;
  privateKey: string;
  apiBaseUrl: string;
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

function parsePositiveInteger(value: string | undefined, variableName: string) {
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

  return ok(parsed);
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, '\n');
}

function normalizeApiBaseUrl(apiBaseUrl: string | undefined) {
  if (apiBaseUrl === undefined || apiBaseUrl.trim() === '') {
    return ok(defaultApiBaseUrl);
  }

  try {
    return ok(new URL(apiBaseUrl).toString().replace(/\/$/, ''));
  } catch {
    return err<string, GitHubConfigError>({
      kind: 'invalid_configuration',
      operation: 'load_github_app_config',
      detail: 'GITHUB_API_BASE_URL must be a valid URL.'
    });
  }
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

  const installationId = parsePositiveInteger(
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

  const apiBaseUrl = normalizeApiBaseUrl(env.GITHUB_API_BASE_URL);
  if (!apiBaseUrl.ok) {
    return err<GitHubAppConfig, GitHubConfigError>(apiBaseUrl.error);
  }

  return ok({
    appId: appId.value,
    installationId: installationId.value,
    privateKey: privateKey.value,
    apiBaseUrl: apiBaseUrl.value
  });
}
