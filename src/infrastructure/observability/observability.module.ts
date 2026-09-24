import { ENV } from '../config/config.constants';
import { Global, Inject, Module } from '@nestjs/common';

import { Env } from '../config/env.schema';
import { LOGGER } from './correlation.constants';
import { StructuredLogger } from './pino.logger';
import { CorrelationIdInterceptor } from './correlation-id.interceptor';

@Global()
@Module({
  providers: [
    CorrelationIdInterceptor,
    {
      provide: LOGGER,
      inject: [ENV],
      useFactory: (env: Env): StructuredLogger => new StructuredLogger(env.logLevel, env.appRole),
    },
  ],
  exports: [LOGGER, CorrelationIdInterceptor],
})
export class ObservabilityModule {
  constructor(@Inject(LOGGER) private readonly logger: StructuredLogger) {}
}
