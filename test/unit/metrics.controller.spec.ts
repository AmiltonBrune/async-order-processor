import { MetricsController } from '../../src/interface/http/metrics/metrics.controller';
import { PrometheusMetrics } from '../../src/infrastructure/observability/prometheus.metrics';

describe('MetricsController', () => {
  it('devolve o texto que o registry produziu', async () => {
    const metrics = new PrometheusMetrics('relay');
    metrics.contarPedidoCriado();

    const corpo = await new MetricsController(metrics).scrape();

    expect(corpo).toContain('orders_created_total 1');
    expect(corpo).toContain('outbox_pending_messages');
  });
});
