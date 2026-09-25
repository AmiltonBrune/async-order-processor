import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { METRICS } from '../../../infrastructure/observability/metrics.constants';
import { PrometheusMetrics } from '../../../infrastructure/observability/prometheus.metrics';
import { Public } from '../common/decorators/public.decorator';

// Fora do Swagger de propósito: o consumidor deste endpoint é o Prometheus, não
// quem lê a documentação da API.
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS) private readonly metrics: PrometheusMetrics) {}

  @Get()
  @Public()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
