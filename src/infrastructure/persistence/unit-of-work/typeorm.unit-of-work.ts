import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

import {
  TransactionalRepositories,
  UnitOfWork,
} from '../../../domain/ports/unit-of-work.port';
import { TypeOrmInboxRepository } from '../inbox/inbox.repository';
import { TypeOrmOrderRepository } from '../order/order.repository';
import { TypeOrmOutboxRepository } from '../outbox/outbox.repository';
import { TypeOrmProductRepository } from '../product/product.repository';
import { TypeOrmStockRepository } from '../stock/stock.repository';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  async runInTransaction<T>(
    work: (repositories: TransactionalRepositories) => Promise<T>,
  ): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
    try {
      const result = await work(TypeOrmUnitOfWork.repositoriesOf(runner));
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  static repositoriesOf(runner: QueryRunner): TransactionalRepositories {
    return {
      orders: new TypeOrmOrderRepository(runner),
      products: new TypeOrmProductRepository(runner),
      stock: new TypeOrmStockRepository(runner),
      outbox: new TypeOrmOutboxRepository(runner),
      inbox: new TypeOrmInboxRepository(runner),
    };
  }
}
