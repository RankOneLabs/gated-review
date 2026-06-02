import { err, ok, type Result } from '#root/src/result.js';
import { validationRejectedError, type ToolDomainError } from '#root/src/errors.js';

const shellMetacharacters = /[\s"'`$&|;<>(){}[\]\\!*?~^]/;

function createValidationError(operation: string, detail: string): ToolDomainError {
  return validationRejectedError(operation, detail);
}

function validateRefSegment(
  value: string,
  operation: string,
  label: string
): Result<string, ToolDomainError> {
  if (value.trim() === '') {
    return err(createValidationError(operation, `${label} must not be empty.`));
  }

  if (value !== value.trim()) {
    return err(createValidationError(operation, `${label} must not include leading or trailing whitespace.`));
  }

  if (shellMetacharacters.test(value)) {
    return err(createValidationError(operation, `${label} contains unsupported characters.`));
  }

  if (value.startsWith('-')) {
    return err(createValidationError(operation, `${label} must not start with a dash.`));
  }

  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes(':')
  ) {
    return err(createValidationError(operation, `${label} is not a safe git ref.`));
  }

  return ok(value);
}

export function validateGitBranchName(
  branchName: string,
  operation: string
): Result<string, ToolDomainError> {
  return validateRefSegment(branchName, operation, 'branch');
}

export function validateGitRefspec(
  refspec: string,
  operation: string
): Result<string, ToolDomainError> {
  if (refspec.trim() === '') {
    return err(createValidationError(operation, 'refspec must not be empty.'));
  }

  if (refspec !== refspec.trim()) {
    return err(createValidationError(operation, 'refspec must not include leading or trailing whitespace.'));
  }

  if (shellMetacharacters.test(refspec)) {
    return err(createValidationError(operation, 'refspec contains unsupported characters.'));
  }

  const leadingPlus = refspec.startsWith('+') ? '+' : '';
  const body = leadingPlus === '+' ? refspec.slice(1) : refspec;
  const colonIndex = body.indexOf(':');

  if (colonIndex === -1) {
    const singleRef = validateRefSegment(body, operation, 'refspec');
    if (!singleRef.ok) {
      return singleRef;
    }

    return ok(`${leadingPlus}${singleRef.value}`);
  }

  if (body.indexOf(':', colonIndex + 1) !== -1) {
    return err(createValidationError(operation, 'refspec may contain at most one colon.'));
  }

  const source = body.slice(0, colonIndex);
  const destination = body.slice(colonIndex + 1);
  if (source.trim() === '' || destination.trim() === '') {
    return err(createValidationError(operation, 'refspec must include both source and destination refs.'));
  }

  const sourceValidation = validateRefSegment(source, operation, 'refspec source');
  if (!sourceValidation.ok) {
    return sourceValidation;
  }

  const destinationValidation = validateRefSegment(destination, operation, 'refspec destination');
  if (!destinationValidation.ok) {
    return destinationValidation;
  }

  return ok(`${leadingPlus}${sourceValidation.value}:${destinationValidation.value}`);
}

export function describeGitRefInput(value: string) {
  return value.trim();
}
