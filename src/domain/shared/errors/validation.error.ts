import { DomainError } from './domain.error';
import { FailureCode } from './failure-code.enum';

export class ValidationError extends DomainError {
  constructor(code: FailureCode, message: string) {
    super(code, message);
  }
}
