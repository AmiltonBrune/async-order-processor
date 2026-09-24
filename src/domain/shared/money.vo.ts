import Decimal from 'decimal.js';

export class Money {
  static readonly SCALE = 2;
  static readonly DEFAULT_CURRENCY = 'BRL';

  private constructor(
    private readonly decimal: Decimal,
    readonly currency: string,
  ) {}

  static of(value: string | number | Decimal, currency: string = Money.DEFAULT_CURRENCY): Money {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) {
      throw new RangeError(`Valor monetario invalido: ${String(value)}`);
    }
    if (decimal.decimalPlaces() > Money.SCALE) {
      throw new RangeError(
        `Valor monetario com mais de ${Money.SCALE} casas decimais: ${decimal.toString()}`,
      );
    }
    return new Money(decimal, currency);
  }

  static zero(currency: string = Money.DEFAULT_CURRENCY): Money {
    return new Money(new Decimal(0), currency);
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.decimal.plus(other.decimal), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.decimal.minus(other.decimal), this.currency);
  }

  /** Multiplicacao por quantidade inteira — a unica que o dominio precisa. */
  times(quantity: number): Money {
    if (!Number.isInteger(quantity)) {
      throw new RangeError(`Quantidade deve ser inteira: ${quantity}`);
    }
    return new Money(this.decimal.times(quantity), this.currency);
  }

  isNegative(): boolean {
    return this.decimal.isNegative();
  }

  isZero(): boolean {
    return this.decimal.isZero();
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.decimal.equals(other.decimal);
  }

  /** Representacao canonica: a mesma que vai para o banco e para o JSON. */
  toFixed2(): string {
    return this.decimal.toFixed(Money.SCALE);
  }

  toString(): string {
    return this.toFixed2();
  }

  toJSON(): string {
    return this.toFixed2();
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new TypeError(
        `Operacao entre moedas diferentes: ${this.currency} e ${other.currency}`,
      );
    }
  }
}
