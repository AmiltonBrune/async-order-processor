import { Money } from '../../domain/shared/money.vo';
import { Transformer } from './transformer.port';

export const moneyTransformer: Transformer<Money, string> = {
  to: (value) => (value === null || value === undefined ? null : value.toFixed2()),
  from: (value) => (value === null || value === undefined ? null : Money.of(value)),
};
