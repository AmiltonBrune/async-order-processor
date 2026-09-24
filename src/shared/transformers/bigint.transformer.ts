import { Transformer } from './transformer.port';

export const bigintTransformer: Transformer<number, number, string | number> = {
  to: (value) => value ?? null,
  from: (value) => (value === null || value === undefined ? null : Number(value)),
};
