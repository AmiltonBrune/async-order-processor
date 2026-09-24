import { Global, Module } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { PROCESSING_DELAY_MS } from '../../application/process-order/process-order.constants';
import { CLOCK, Clock } from '../../domain/ports/system/clock.port';
import { ID_GENERATOR, IdGenerator } from '../../domain/ports/system/id-generator.port';
import { ENV } from './config.constants';
import { Env, loadEnv } from './env.schema';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: PROCESSING_DELAY_MS,
      inject: [ENV],
      useFactory: (env: Env): number => env.processingDelayMs,
    },
    { provide: CLOCK, useValue: { now: (): Date => new Date() } satisfies Clock },
    { provide: ID_GENERATOR, useValue: { next: (): string => uuidv7() } satisfies IdGenerator },
  ],
  exports: [ENV, PROCESSING_DELAY_MS, CLOCK, ID_GENERATOR],
})
export class ConfigModule {}
