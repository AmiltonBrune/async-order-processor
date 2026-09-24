import { Money } from '../../src/domain/shared/money.vo';

describe('Money', () => {
  it('soma sem o erro de ponto flutuante que 0.1 + 0.2 produz', () => {
    const soma = Money.of('0.10').plus(Money.of('0.20'));
    expect(soma.toFixed2()).toBe('0.30');
    expect(soma.equals(Money.of('0.30'))).toBe(true);
  });

  it('multiplica por quantidade inteira sem perder centavo', () => {
    expect(Money.of('0.10').times(3).toFixed2()).toBe('0.30');
    expect(Money.of('3.33').times(7).toFixed2()).toBe('23.31');
    expect(Money.of('19.99').times(101).toFixed2()).toBe('2018.99');
  });

  it('suporta o limite de DECIMAL(12,2) sem arredondar', () => {
    expect(Money.of('4999999.99').times(2).toFixed2()).toBe('9999999.98');
    expect(Money.of('9999999999.99').toFixed2()).toBe('9999999999.99');
  });

  it('e imutavel: operacoes devolvem instancia nova e nao tocam na original', () => {
    const original = Money.of('10.00');
    const somado = original.plus(Money.of('5.00'));
    expect(original.toFixed2()).toBe('10.00');
    expect(somado.toFixed2()).toBe('15.00');
    expect(somado).not.toBe(original);
  });

  it('recusa valor com mais casas decimais do que o banco guarda', () => {
    expect(() => Money.of('0.005')).toThrow(RangeError);
    expect(() => Money.of('1.999')).toThrow(RangeError);
  });

  it('recusa valor nao finito', () => {
    expect(() => Money.of(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => Money.of(Number.NaN)).toThrow(RangeError);
  });

  it('recusa operacao entre moedas diferentes', () => {
    expect(() => Money.of('1.00', 'BRL').plus(Money.of('1.00', 'USD'))).toThrow(TypeError);
    expect(Money.of('1.00', 'BRL').equals(Money.of('1.00', 'USD'))).toBe(false);
  });

  it('recusa multiplicacao por quantidade fracionaria', () => {
    expect(() => Money.of('10.00').times(1.5)).toThrow(RangeError);
  });

  it('serializa para JSON como string decimal, nao como float', () => {
    expect(JSON.stringify({ total: Money.of('29.99') })).toBe('{"total":"29.99"}');
  });

  it('toString devolve a mesma forma canônica de toFixed2', () => {
    const valor = Money.of('29.9');
    expect(`${valor}`).toBe('29.90');
    expect(valor.toString()).toBe(valor.toFixed2());
  });

  it('subtrai e reconhece zero e negativo', () => {
    expect(Money.of('10.00').minus(Money.of('10.00')).isZero()).toBe(true);
    expect(Money.of('1.00').minus(Money.of('2.00')).isNegative()).toBe(true);
    expect(Money.zero().toFixed2()).toBe('0.00');
  });

  // Sem a checagem de moeda, 10 BRL + 10 USD devolveria 20 de alguma coisa.
  describe('moedas diferentes não se somam', () => {
    it('plus recusa', () => {
      expect(() => Money.of('10.00', 'BRL').plus(Money.of('10.00', 'USD'))).toThrow();
    });

    it('minus recusa', () => {
      expect(() => Money.of('10.00', 'BRL').minus(Money.of('10.00', 'USD'))).toThrow();
    });

    it('a mesma moeda continua somando', () => {
      expect(Money.of('10.00', 'USD').plus(Money.of('5.50', 'USD')).toFixed2()).toBe('15.50');
    });
  });

});
