import { EntitySchema } from 'typeorm';

import { Money } from '../../../domain/shared/money.vo';
import { bigintTransformer, moneyTransformer } from '../../../shared/transformers';

export interface ProductRow {
  id: number;
  name: string;
  price: Money;
  stock: number;
}

export const ProductEntity = new EntitySchema<ProductRow>({
  name: 'Product',
  tableName: 'products',
  columns: {
    id: { type: 'bigint', primary: true, generated: 'increment', transformer: bigintTransformer },
    name: { type: 'varchar', length: 128 },
    price: { type: 'decimal', precision: 12, scale: 2, transformer: moneyTransformer },
    stock: { type: 'int', unsigned: true },
  },
});
