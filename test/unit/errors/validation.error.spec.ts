import { DomainError } from '../../../src/domain/shared/errors/domain.error';
import { ValidationError } from '../../../src/domain/shared/errors/validation.error';

describe('ValidationError', () => {
  it('reprova entrada malformada sem se confundir com regra de negócio', () => {
    const erro = new ValidationError('VALIDATION_ERROR', 'quantidade deve ser positiva');
    expect(erro).toBeInstanceOf(DomainError);
    expect(erro.code).toBe('VALIDATION_ERROR');
    expect(erro.name).toBe('ValidationError');
  });
});
