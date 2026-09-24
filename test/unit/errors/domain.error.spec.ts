import { BusinessRuleViolation } from '../../../src/domain/shared/errors/business-rule-violation.error';
import { DomainError } from '../../../src/domain/shared/errors/domain.error';
import { ValidationError } from '../../../src/domain/shared/errors/validation.error';

describe('DomainError', () => {
  it('é a raiz comum dos erros que o domínio sabe nomear', () => {
    expect(new BusinessRuleViolation('INSUFFICIENT_STOCK', 'x')).toBeInstanceOf(DomainError);
    expect(new ValidationError('VALIDATION_ERROR', 'x')).toBeInstanceOf(DomainError);
    expect(new BusinessRuleViolation('INSUFFICIENT_STOCK', 'x')).toBeInstanceOf(Error);
  });

  it('batiza a instância com o nome da subclasse concreta', () => {
    expect(new BusinessRuleViolation('INSUFFICIENT_STOCK', 'x').name).toBe('BusinessRuleViolation');
    expect(new ValidationError('VALIDATION_ERROR', 'x').name).toBe('ValidationError');
  });

  it('carrega código e mensagem separados: um vai para failure_code, o outro para o log', () => {
    const erro = new BusinessRuleViolation('INSUFFICIENT_STOCK', 'estoque insuficiente');
    expect(erro.code).toBe('INSUFFICIENT_STOCK');
    expect(erro.message).toBe('estoque insuficiente');
  });
});
