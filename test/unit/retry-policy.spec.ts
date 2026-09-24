import { BusinessRuleViolation, TransientError } from '../../src/domain/shared/errors';
import { RetryPolicy } from '../../src/domain/shared/retry-policy';

const policy = new RetryPolicy([5_000, 15_000, 45_000]);

describe('RetryPolicy', () => {
  it('nunca retenta erro de negocio', () => {
    const decisao = policy.decide(
      new BusinessRuleViolation('INSUFFICIENT_STOCK', 'estoque insuficiente'),
      1,
    );
    expect(decisao).toEqual({
      kind: 'FAIL_BUSINESS',
      code: 'INSUFFICIENT_STOCK',
      reason: 'estoque insuficiente',
    });
  });

  it('erro de negocio na ultima tentativa continua sendo erro de negocio', () => {
    const decisao = policy.decide(new BusinessRuleViolation('PRODUCT_NOT_FOUND', 'sumiu'), 4);
    expect(decisao.kind).toBe('FAIL_BUSINESS');
  });

  it.each([
    [1, 5_000, 2],
    [2, 15_000, 3],
    [3, 45_000, 4],
  ])('na tentativa %i retenta com backoff de %ims', (tentativa, atraso, proxima) => {
    expect(policy.decide(new TransientError('broker reiniciando'), tentativa)).toEqual({
      kind: 'RETRY',
      nextAttempt: proxima,
      delayMs: atraso,
    });
  });

  it('manda para a dead-letter quando os degraus acabam', () => {
    expect(policy.decide(new TransientError('broker fora'), 4)).toEqual({
      kind: 'DEAD_LETTER',
      reason: 'broker fora',
    });
    expect(policy.decide(new TransientError('broker fora'), 99).kind).toBe('DEAD_LETTER');
  });

  it('trata erro desconhecido como transitorio, nao como fatal', () => {
    expect(policy.decide(new Error('TypeError inesperado'), 1).kind).toBe('RETRY');
    expect(policy.decide({ nao: 'e nem Error' }, 1).kind).toBe('RETRY');
    expect(policy.decide(undefined, 1).kind).toBe('RETRY');
  });

  it('expoe o numero total de tentativas como primeira mais retentativas', () => {
    expect(policy.maxAttempts).toBe(4);
    expect(new RetryPolicy([100]).maxAttempts).toBe(2);
  });

  it('preserva a mensagem real do erro, que e o que o plantao le', () => {
    expect(RetryPolicy.reasonOf(new Error('ER_LOCK_DEADLOCK'))).toBe('ER_LOCK_DEADLOCK');
    expect(RetryPolicy.reasonOf('texto solto')).toBe('texto solto');
    expect(RetryPolicy.reasonOf(new Error(''))).toBe('Erro desconhecido no processamento');
    expect(RetryPolicy.reasonOf(null)).toBe('Erro desconhecido no processamento');
  });

  it('a falha definitiva vira RETRIES_EXHAUSTED carregando o erro real', () => {
    const erro = RetryPolicy.exhausted(new TransientError('conexao MySQL caiu'));
    expect(erro.code).toBe('RETRIES_EXHAUSTED');
    expect(erro.message).toBe('conexao MySQL caiu');
  });

  it('sem argumento, usa os degraus padrão de 5s, 15s e 45s', () => {
    const padrao = new RetryPolicy();
    expect(padrao.maxAttempts).toBe(4);
    expect(padrao.decide(new TransientError('x'), 1)).toMatchObject({ delayMs: 5_000 });
    expect(padrao.decide(new TransientError('x'), 2)).toMatchObject({ delayMs: 15_000 });
    expect(padrao.decide(new TransientError('x'), 3)).toMatchObject({ delayMs: 45_000 });
    expect(padrao.decide(new TransientError('x'), 4).kind).toBe('DEAD_LETTER');
  });

  it.each([0, -1, 1.5])('recusa numero de tentativa invalido: %s', (tentativa) => {
    expect(() => policy.decide(new Error('x'), tentativa)).toThrow(RangeError);
  });

  it('recusa politica sem nenhum degrau', () => {
    expect(() => new RetryPolicy([])).toThrow(RangeError);
  });

  describe('reasonOf com o que não é Error nem texto útil', () => {
    it('devolve a própria string quando o erro é texto', () => {
      expect(RetryPolicy.reasonOf('deu ruim no broker')).toBe('deu ruim no broker');
    });

    it.each([
      ['string vazia', ''],
      ['número', 42],
      ['objeto solto', { erro: 'x' }],
      ['nulo', null],
      ['indefinido', undefined],
    ])('cai no texto padrão em vez de devolver o valor cru — %s', (_caso, valor) => {
      expect(RetryPolicy.reasonOf(valor)).toBe('Erro desconhecido no processamento');
    });
  });

});
