import { TransientError } from '../../../domain/shared/errors';

const TRANSIENT_CODES = new Set([
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
  'ER_TOO_MANY_USER_CONNECTIONS',
  'ER_CON_COUNT_ERROR',
]);

const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

export function isDuplicateEntry(error: unknown): boolean {
  return codeOf(error) === DUPLICATE_ENTRY;
}

export function asTransientIfRetryable(error: unknown): unknown {
  const code = codeOf(error);
  if (code !== undefined && TRANSIENT_CODES.has(code)) {
    return new TransientError(`MySQL ${code}`, error);
  }
  return error;
}

/**
 * O código do MySQL pode chegar de dois jeitos: direto no erro (driver cru) ou
 * dentro de `driverError`, quando o TypeORM embrulha em `QueryFailedError`.
 * Ler só um dos dois faz a detecção de chave duplicada falhar em silêncio — e
 * chave duplicada é a base das três camadas de idempotência.
 */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direto = (error as { code?: unknown }).code;
  if (typeof direto === 'string') return direto;
  const doDriver = (error as { driverError?: { code?: unknown } }).driverError?.code;
  return typeof doDriver === 'string' ? doDriver : undefined;
}
