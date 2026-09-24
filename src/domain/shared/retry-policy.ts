import { BusinessRuleViolation, FailureCode, isBusinessError } from './errors';

export type RetryDecision =
  | { readonly kind: 'FAIL_BUSINESS'; readonly code: FailureCode; readonly reason: string }
  | { readonly kind: 'RETRY'; readonly nextAttempt: number; readonly delayMs: number }
  | { readonly kind: 'DEAD_LETTER'; readonly reason: string };

export class RetryPolicy {
  static readonly DEFAULT_TIERS_MS: readonly number[] = [5_000, 15_000, 45_000];

  constructor(private readonly tiersMs: readonly number[] = RetryPolicy.DEFAULT_TIERS_MS) {
    if (tiersMs.length === 0) {
      throw new RangeError('RetryPolicy precisa de ao menos um degrau de backoff');
    }
  }

  get maxAttempts(): number {
    return this.tiersMs.length + 1;
  }

  decide(error: unknown, attempt: number): RetryDecision {
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new RangeError(`Numero de tentativa invalido: ${attempt}`);
    }
    if (isBusinessError(error)) {
      return { kind: 'FAIL_BUSINESS', code: error.code, reason: error.message };
    }
    const delayMs = this.tiersMs[attempt - 1];
    if (delayMs === undefined) {
      return { kind: 'DEAD_LETTER', reason: RetryPolicy.reasonOf(error) };
    }
    return { kind: 'RETRY', nextAttempt: attempt + 1, delayMs };
  }

  /** Mensagem real do erro, que e o que o plantao precisa ler em `failure_reason`. */
  static reasonOf(error: unknown): string {
    if (error instanceof Error && error.message !== '') return error.message;
    if (typeof error === 'string' && error !== '') return error;
    return 'Erro desconhecido no processamento';
  }

  /** Atalho de leitura para quem monta a mensagem de falha definitiva. */
  static exhausted(error: unknown): BusinessRuleViolation {
    return new BusinessRuleViolation('RETRIES_EXHAUSTED', RetryPolicy.reasonOf(error));
  }
}
