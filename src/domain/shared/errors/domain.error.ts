import { FailureCode } from './failure-code.enum';

export abstract class DomainError extends Error {
  protected constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
