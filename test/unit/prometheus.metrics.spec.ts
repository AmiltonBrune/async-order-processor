import { PrometheusMetrics } from '../../src/infrastructure/observability/prometheus.metrics';

const valorDe = (texto: string, linhaQueComeçaCom: string): number => {
  const linha = texto
    .split('\n')
    .find((atual) => atual.startsWith(linhaQueComeçaCom) && !atual.startsWith('#'));
  if (linha === undefined) throw new Error(`métrica ausente: ${linhaQueComeçaCom}`);
  return Number(linha.split(' ').pop());
};

describe('PrometheusMetrics', () => {
  it('expõe o formato de texto que o Prometheus raspa', async () => {
    const metrics = new PrometheusMetrics();
    expect(metrics.contentType).toContain('text/plain');
    expect(await metrics.render()).toContain('# HELP');
  });

  it('inclui as métricas padrão do processo Node', async () => {
    const texto = await new PrometheusMetrics().render();
    expect(texto).toContain('process_cpu_user_seconds_total');
    expect(texto).toContain('nodejs_eventloop_lag_seconds');
  });

  it('conta pedidos criados', async () => {
    const metrics = new PrometheusMetrics();
    metrics.contarPedidoCriado();
    metrics.contarPedidoCriado();
    expect(valorDe(await metrics.render(), 'orders_created_total')).toBe(2);
  });

  it('separa os desfechos do processamento por rótulo', async () => {
    const metrics = new PrometheusMetrics();
    metrics.contarProcessamento('PROCESSED');
    metrics.contarProcessamento('PROCESSED');
    metrics.contarProcessamento('FAILED');
    metrics.contarProcessamento('DUPLICATE');
    metrics.contarProcessamento('DEAD_LETTER');

    const texto = await metrics.render();
    expect(valorDe(texto, 'orders_processed_total{outcome="PROCESSED"}')).toBe(2);
    expect(valorDe(texto, 'orders_processed_total{outcome="FAILED"}')).toBe(1);
    expect(valorDe(texto, 'orders_processed_total{outcome="DUPLICATE"}')).toBe(1);
    expect(valorDe(texto, 'orders_processed_total{outcome="DEAD_LETTER"}')).toBe(1);
  });

  it('observa a duração da requisição em segundos, não em milissegundos', async () => {
    const metrics = new PrometheusMetrics();
    metrics.observarRequisicao('POST', '/orders', 201, 250);

    const texto = await metrics.render();
    expect(valorDe(texto, 'http_request_duration_seconds_sum{method="POST"')).toBeCloseTo(0.25);
    expect(valorDe(texto, 'http_request_duration_seconds_count{method="POST"')).toBe(1);
  });

  describe('gauges da outbox', () => {
    it('no relay, refletem o último valor e não a soma', async () => {
      const metrics = new PrometheusMetrics('relay');
      metrics.registrarOutbox(12, 30);
      metrics.registrarOutbox(3, 5);

      const texto = await metrics.render();
      expect(valorDe(texto, 'outbox_pending_messages')).toBe(3);
      expect(valorDe(texto, 'outbox_oldest_pending_seconds')).toBe(5);
    });

    // Registradas em todo processo, a API e o consumidor publicariam zero para
    // sempre — uma série que parece saudável e nunca foi medida.
    it.each(['api', 'consumer'])('não existem no papel %s', async (papel) => {
      const texto = await new PrometheusMetrics(papel).render();
      expect(texto).not.toContain('outbox_pending_messages');
      expect(texto).not.toContain('outbox_oldest_pending_seconds');
    });

    it('chamar registrarOutbox fora do relay não quebra', async () => {
      const metrics = new PrometheusMetrics('api');
      expect(() => metrics.registrarOutbox(9, 9)).not.toThrow();
      expect(await metrics.render()).not.toContain('outbox_pending_messages');
    });
  });

  it('cada instância tem o próprio registry, sem vazar entre testes', async () => {
    const primeira = new PrometheusMetrics();
    primeira.contarPedidoCriado();
    const segunda = new PrometheusMetrics();

    expect(valorDe(await primeira.render(), 'orders_created_total')).toBe(1);
    expect(valorDe(await segunda.render(), 'orders_created_total')).toBe(0);
  });
});
