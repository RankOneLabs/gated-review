import type { ToolEntity } from '#root/src/domain.js';

export type ToolDomainError =
  | {
      kind: 'not_implemented';
      operation: string;
      entity: ToolEntity;
      detail: string;
    }
  | {
      kind: 'github_error';
      operation: string;
      entity: ToolEntity;
      detail: string;
    }
  | {
      kind: 'validation_rejected';
      operation: string;
      entity: ToolEntity;
      detail: string;
    }
  | {
      kind: 'git_command_failed';
      operation: string;
      entity: ToolEntity;
      commandKind: string;
      detail: string;
    };

export function toolEntity(name: string): ToolEntity {
  return { kind: 'tool', name };
}

export function notImplementedError(operation: string, detail = 'Tool is not implemented yet.'): ToolDomainError {
  return {
    kind: 'not_implemented',
    operation,
    entity: toolEntity(operation),
    detail
  };
}

export function githubError(operation: string, detail: string): ToolDomainError {
  return {
    kind: 'github_error',
    operation,
    entity: toolEntity(operation),
    detail
  };
}

export function validationRejectedError(operation: string, detail: string): ToolDomainError {
  return {
    kind: 'validation_rejected',
    operation,
    entity: toolEntity(operation),
    detail
  };
}

export function gitCommandFailedError(
  operation: string,
  commandKind: string,
  detail: string
): ToolDomainError {
  return {
    kind: 'git_command_failed',
    operation,
    entity: toolEntity(operation),
    commandKind,
    detail
  };
}

export function describeToolError(error: ToolDomainError): string {
  return `${error.kind}: ${error.operation} :: ${error.detail}`;
}
