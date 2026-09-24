import { BusinessRuleViolation } from '../../../src/domain/shared/errors/business-rule-violation.error';

describe('BusinessRuleViolation', () => {
  it('leva o código que o consumidor grava em failure_code', () => {
    const erro = new BusinessRuleViolation('INSUFFICIENT_STOCK', 'estoque insuficiente');
    expect(erro.code).toBe('INSUFFICIENT_STOCK');
    expect(erro.message).toBe('estoque insuficiente');
  });

  it('serve a qualquer regra de negócio violada, não só a de estoque', () => {
    expect(new BusinessRuleViolation('ORDER_NOT_FOUND', 'x').code).toBe('ORDER_NOT_FOUND');
    expect(new BusinessRuleViolation('DUPLICATE_PRODUCT_IN_ORDER', 'x').code).toBe(
      'DUPLICATE_PRODUCT_IN_ORDER',
    );
  });
});
