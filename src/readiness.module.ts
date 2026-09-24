import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { READINESS_PROBES } from './domain/ports/system/readiness-probe.port';
import { AmqpConnection } from './infrastructure/messaging/amqp/amqp.connection';
import { AmqpProbe } from './infrastructure/messaging/amqp/amqp.probe';
import { MySqlProbe } from './infrastructure/persistence/health/mysql.probe';

@Global()
@Module({
  providers: [
    {
      provide: READINESS_PROBES,
      inject: [DataSource, AmqpConnection],
      useFactory: (dataSource: DataSource, amqp: AmqpConnection) => [
        new MySqlProbe(dataSource),
        new AmqpProbe(amqp),
      ],
    },
  ],
  exports: [READINESS_PROBES],
})
export class ReadinessModule {}
