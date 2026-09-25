import { ENV } from '../config/config.constants';
import { Global, Inject, Module } from '@nestjs/common';

import { Env } from '../config/env.schema';
import { LOGGER } from './correlation.constants';
import { METRICS } from './metrics.constants';
import { PrometheusMetrics } from './prometheus.metrics';
import { StructuredLogger } from './pino.logger';
import { CorrelationIdInterceptor } from './correlation-id.interceptor';

@Global()
@Module({
  providers: [
    CorrelationIdInterceptor,
    {
      provide: METRICS,
      inject: [ENV],
      useFactory: (env: Env): PrometheusMetrics => new PrometheusMetrics(env.appRole),
    },
    {
      provide: LOGGER,
      inject: [ENV],
      useFactory: (env: Env): StructuredLogger => new StructuredLogger(env.logLevel, env.appRole),
    },
  ],
  exports: [LOGGER, METRICS, CorrelationIdInterceptor],
})
export class ObservabilityModule {
  constructor(@Inject(LOGGER) private readonly logger: StructuredLogger) {}
}
