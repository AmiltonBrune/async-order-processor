import { QueryRunner } from 'typeorm';

import { StockRepository } from '../../../domain/ports/repositories/stock.repository.port';
import { isDuplicateEntry } from '../errors/mysql.errors';
import { StockReservationEntity } from './stock-reservation.entity-schema';

export class TypeOrmStockRepository implements StockRepository {
  constructor(private readonly runner: QueryRunner) {}

  async reserve(
    orderId: string,
    productId: number,
    quantity: number,
    at: Date,
  ): Promise<boolean> {
    try {
      await this.runner.manager
        .getRepository(StockReservationEntity)
        .insert({ orderId, productId, quantity, reservedAt: at });
      return true;
    } catch (error) {
      if (isDuplicateEntry(error)) return false;
      throw error;
    }
  }
}
