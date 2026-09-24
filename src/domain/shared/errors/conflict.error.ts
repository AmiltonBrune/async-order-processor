import { DomainError } from './domain.error';
import { FailureCode } from './failure-code.enum';

export class ConflictError extends DomainError {
  constructor(code: FailureCode, message: string) {
    super(code, message);
  }
}
