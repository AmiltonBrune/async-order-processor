import {
  bigintTransformer,
  moneyTransformer,
} from '../../src/shared/transformers';
import { Money } from '../../src/domain/shared/money.vo';

describe('moneyTransformer', () => {
  it('grava Money como string decimal', () => {
    expect(moneyTransformer.to(Money.of('29.99'))).toBe('29.99');
    expect(moneyTransformer.to(Money.of('0.10'))).toBe('0.10');
  });

  it('lê a string do DECIMAL de volta como Money, sem passar por number', () => {
    const valor = moneyTransformer.from('9999999999.99') as Money;
    expect(valor).toBeInstanceOf(Money);
    expect(valor.toFixed2()).toBe('9999999999.99');
  });

  it('faz ida e volta sem perder um centavo', () => {
    for (const bruto of ['0.01', '0.10', '3.33', '249.90', '1234567.89']) {
      const ida = moneyTransformer.to(Money.of(bruto)) as string;
      expect((moneyTransformer.from(ida) as Money).toFixed2()).toBe(bruto);
    }
  });

  it.each([
    ['nulo', null],
    ['indefinido', undefined],
  ])('trata %s nos dois sentidos', (_caso, valor) => {
    expect(moneyTransformer.to(valor)).toBeNull();
    expect(moneyTransformer.from(valor)).toBeNull();
  });
});

describe('bigintTransformer', () => {
  it('converte a string do BIGINT para número', () => {
    expect(bigintTransformer.from('7')).toBe(7);
    expect(bigintTransformer.from(7)).toBe(7);
  });

  it('grava número como número', () => {
    expect(bigintTransformer.to(7)).toBe(7);
  });

  it.each([
    ['nulo', null],
    ['indefinido', undefined],
  ])('trata %s nos dois sentidos', (_caso, valor) => {
    expect(bigintTransformer.to(valor)).toBeNull();
    expect(bigintTransformer.from(valor)).toBeNull();
  });
});
