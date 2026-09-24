import { TransientError } from '../../src/domain/shared/errors';
import {
  asTransientIfRetryable,
  isDuplicateEntry,
} from '../../src/infrastructure/persistence/errors/mysql.errors';

describe('classificação de erro do MySQL', () => {
  it('reconhece chave duplicada — a base das três camadas de idempotência', () => {
    expect(isDuplicateEntry({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isDuplicateEntry({ code: 'ER_LOCK_DEADLOCK' })).toBe(false);
  });

  it('lê o código de dentro de driverError, como o TypeORM embrulha', () => {
    expect(isDuplicateEntry({ driverError: { code: 'ER_DUP_ENTRY' } })).toBe(true);
    expect(isDuplicateEntry({ driverError: { code: 'ER_NO_SUCH_TABLE' } })).toBe(false);
    expect(isDuplicateEntry({ driverError: {} })).toBe(false);
    expect(isDuplicateEntry({ driverError: { code: 42 } })).toBe(false);
  });

  it.each([null, undefined, 'texto', 42, {}, { code: 42 }])(
    'não confunde %s com chave duplicada',
    (erro) => {
      expect(isDuplicateEntry(erro)).toBe(false);
    },
  );

  it.each([
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
    'PROTOCOL_CONNECTION_LOST',
    'ECONNRESET',
    'ETIMEDOUT',
    'ER_TOO_MANY_USER_CONNECTIONS',
    'ER_CON_COUNT_ERROR',
  ])('trata %s como transitório', (code) => {
    const classificado = asTransientIfRetryable({ code });
    expect(classificado).toBeInstanceOf(TransientError);
    expect((classificado as TransientError).message).toBe(`MySQL ${code}`);
  });

  it('preserva o erro original como causa, para a investigação', () => {
    const original = { code: 'ER_LOCK_DEADLOCK', sql: 'UPDATE ...' };
    expect((asTransientIfRetryable(original) as TransientError).cause).toBe(original);
  });

  it.each([
    ['erro de negócio do MySQL', { code: 'ER_NO_SUCH_TABLE' }],
    ['erro comum', new Error('qualquer coisa')],
    ['não-erro', 'texto solto'],
    ['nulo', null],
  ])('devolve %s intacto, sem reclassificar', (_caso, erro) => {
    // Reclassificar tudo como transitório faria uma tabela ausente ser retentada
    // 3 vezes antes de ir para a dead-letter, escondendo um erro de migration.
    expect(asTransientIfRetryable(erro)).toBe(erro);
  });
});
