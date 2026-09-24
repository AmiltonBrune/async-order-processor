import { DomainError } from '../../../src/domain/shared/errors/domain.error';
import { NotFoundError } from '../../../src/domain/shared/errors/not-found.error';

describe('NotFoundError', () => {
  it('traduz "não existe" com o código que o HTTP vira 404', () => {
    const erro = new NotFoundError('ORDER_NOT_FOUND', 'pedido não encontrado');
    expect(erro).toBeInstanceOf(DomainError);
    expect(erro.code).toBe('ORDER_NOT_FOUND');
    expect(erro.name).toBe('NotFoundError');
  });
});
