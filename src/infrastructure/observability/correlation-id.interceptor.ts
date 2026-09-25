import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import { CORRELATION_HEADER, LOGGER } from './correlation.constants';
import { METRICS } from './metrics.constants';
import { PrometheusMetrics } from './prometheus.metrics';
import { CorrelationContext } from './correlation.context';
import { StructuredLogger } from './pino.logger';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(
    @Inject(METRICS) private readonly metrics: PrometheusMetrics,
    @Inject(LOGGER) private readonly logger?: StructuredLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, unknown>; method?: string; url?: string }>();
    const response = http.getResponse<{
      setHeader(name: string, value: string): void;
      statusCode?: number;
    }>();

    const correlationId = CorrelationContext.resolve(request.headers[CORRELATION_HEADER]);
    response.setHeader(CORRELATION_HEADER, correlationId);
    request.headers[CORRELATION_HEADER] = correlationId;

    const inicio = Date.now();
    const registrar = (): void => {
      const duracaoMs = Date.now() - inicio;
      const metodo = request.method ?? 'UNKNOWN';
      const rota = request.url ?? 'unknown';
      this.metrics.observarRequisicao(metodo, rota, response.statusCode ?? 0, duracaoMs);
      CorrelationContext.run(correlationId, () => {
        this.logger?.log('Requisicao concluida', {
          metodo,
          rota,
          status: response.statusCode,
          duracaoMs,
        });
      });
    };

    return CorrelationContext.run(correlationId, () =>
      next.handle().pipe(tap({ next: registrar, error: registrar })),
    );
  }
}
