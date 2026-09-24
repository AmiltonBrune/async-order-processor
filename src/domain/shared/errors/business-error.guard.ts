import { BusinessRuleViolation } from './business-rule-violation.error';

export function isBusinessError(error: unknown): error is BusinessRuleViolation {
  return error instanceof BusinessRuleViolation;
}
