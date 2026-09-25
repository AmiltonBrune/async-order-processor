import { ENV } from '../config/config.constants';
import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ORDER_REPOSITORY } from '../../domain/ports/repositories/order.repository.port';
import { USER_REPOSITORY } from '../../domain/ports/repositories/user.repository.port';
import { UNIT_OF_WORK } from '../../domain/ports/unit-of-work.port';
import { Env } from '../config/env.schema';
import { InboxRetentionRepository } from './inbox/inbox-retention.repository';
import { OutboxDispatchRepository } from './outbox/outbox-dispatch.repository';
import { OutboxRetentionRepository } from './outbox/outbox-retention.repository';
import { TypeOrmOrderRepository } from './order/order.repository';
import { TypeOrmUnitOfWork } from './unit-of-work/typeorm.unit-of-work';
import { TypeOrmUserRepository } from './user/user.repository';
import { dataSourceOptions } from './datasource/typeorm.datasource';

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [ENV],
      useFactory: async (env: Env): Promise<DataSource> => {
        const dataSource = new DataSource(dataSourceOptions(env));
        await dataSource.initialize();
        return dataSource;
      },
    },
    { provide: UNIT_OF_WORK, inject: [DataSource], useFactory: (ds: DataSource) => new TypeOrmUnitOfWork(ds) },
    {
      provide: ORDER_REPOSITORY,
      inject: [DataSource],
      useFactory: (ds: DataSource) => new TypeOrmOrderRepository(ds.createQueryRunner()),
    },
    {
      provide: USER_REPOSITORY,
      inject: [DataSource],
      useFactory: (ds: DataSource) => new TypeOrmUserRepository(ds.createQueryRunner()),
    },
    {
      provide: OutboxDispatchRepository,
      inject: [DataSource],
      useFactory: (ds: DataSource) => new OutboxDispatchRepository(ds),
    },
    {
      provide: OutboxRetentionRepository,
      inject: [DataSource],
      useFactory: (ds: DataSource) => new OutboxRetentionRepository(ds),
    },
    {
      provide: InboxRetentionRepository,
      inject: [DataSource],
      useFactory: (ds: DataSource) => new InboxRetentionRepository(ds),
    },
  ],
  exports: [
    DataSource,
    UNIT_OF_WORK,
    ORDER_REPOSITORY,
    USER_REPOSITORY,
    OutboxDispatchRepository,
    OutboxRetentionRepository,
    InboxRetentionRepository,
  ],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
