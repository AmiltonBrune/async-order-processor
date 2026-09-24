import { Product } from '../../product/product.entity';

export interface ProductRepository {
  findByNames(names: readonly string[]): Promise<readonly Product[]>;
  decrementStock(productId: number, quantity: number): Promise<boolean>;
}
