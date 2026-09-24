import { ConflictError } from '../../../src/domain/shared/errors/conflict.error';
import { DomainError } from '../../../src/domain/shared/errors/domain.error';

describe('ConflictError', () => {
  it('traduz "estado incompatível" com o código que o HTTP vira 409', () => {
    const erro = new ConflictError('ORDER_NOT_REPROCESSABLE', 'só pedido FAILED reprocessa');
    expect(erro).toBeInstanceOf(DomainError);
    expect(erro.code).toBe('ORDER_NOT_REPROCESSABLE');
    expect(erro.name).toBe('ConflictError');
  });
});
