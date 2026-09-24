import { isBusinessError } from '../../../src/domain/shared/errors/business-error.guard';
import { BusinessRuleViolation } from '../../../src/domain/shared/errors/business-rule-violation.error';
import { ConflictError } from '../../../src/domain/shared/errors/conflict.error';
import { NotFoundError } from '../../../src/domain/shared/errors/not-found.error';
import { TransientError } from '../../../src/domain/shared/errors/transient.error';

describe('isBusinessError', () => {
  it('reconhece a violação de regra de negócio, que não se retenta', () => {
    expect(isBusinessError(new BusinessRuleViolation('PRODUCT_NOT_FOUND', 'x'))).toBe(true);
  });

  it('recusa o transitório — é justamente ele que deve voltar para a fila', () => {
    expect(isBusinessError(new TransientError('deadlock'))).toBe(false);
  });

  it('recusa os demais erros de domínio, que são resposta de API e não falha de pedido', () => {
    expect(isBusinessError(new NotFoundError('ORDER_NOT_FOUND', 'x'))).toBe(false);
    expect(isBusinessError(new ConflictError('ORDER_NOT_REPROCESSABLE', 'x'))).toBe(false);
  });

  it('não quebra diante do que nem erro é', () => {
    expect(isBusinessError(new Error('qualquer outra'))).toBe(false);
    expect(isBusinessError('nem erro é')).toBe(false);
    expect(isBusinessError(null)).toBe(false);
    expect(isBusinessError(undefined)).toBe(false);
  });
});
