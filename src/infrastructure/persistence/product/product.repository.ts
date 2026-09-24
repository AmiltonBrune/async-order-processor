import { In, QueryRunner } from 'typeorm';

import { Product } from '../../../domain/product/product.entity';
import { ProductRepository } from '../../../domain/ports/repositories/product.repository.port';
import { ProductEntity, ProductRow } from './product.entity-schema';

export class TypeOrmProductRepository implements ProductRepository {
  constructor(private readonly runner: QueryRunner) {}

  async findByNames(names: readonly string[]): Promise<readonly Product[]> {
    const rows = await this.runner.manager.getRepository(ProductEntity).find({
      where: { name: In([...names]) },
    });
    return rows.map((row) => this.hydrate(row));
  }

  async decrementStock(productId: number, quantity: number): Promise<boolean> {
    const resultado = await this.runner.manager
      .createQueryBuilder()
      .update(ProductEntity)
      .set({ stock: () => 'stock - :qty' })
      .where('id = :id AND stock >= :qty', { id: productId, qty: quantity })
      .execute();
    return resultado.affected === 1;
  }

  private hydrate(row: ProductRow): Product {
    return new Product(row.id, row.name, row.price, row.stock);
  }
}
