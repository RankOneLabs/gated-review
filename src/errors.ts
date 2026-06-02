import type { ToolEntity } from '#root/src/domain.js';

export type ToolDomainError =
  | {
      kind: 'not_implemented';
      operation: string;
      entity: ToolEntity;
      detail: string;
    }
  | {
      kind: 'github_request_failed';
      operation: string;
      entity: ToolEntity;
      detail: string;
    }
  | {
      kind: 'validation_rejected';
      operation: string;
      entity: ToolEntity;
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

export function githubRequestFailedError(operation: string, detail: string): ToolDomainError {
  return {
    kind: 'github_request_failed',
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

export function describeToolError(error: ToolDomainError): string {
  return `${error.kind}: ${error.operation} :: ${error.detail}`;
}
