import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type ResultadoDeProcessamento = 'PROCESSED' | 'FAILED' | 'DUPLICATE' | 'DEAD_LETTER';

/**
 * As métricas respondem tendência, que o log estruturado não responde: "a taxa
 * de falha subiu?", "a outbox está drenando?". Investigação caso a caso
 * continua sendo pelo correlationId.
 *
 * A taxa de falha por código (INSUFFICIENT_STOCK e afins) fica de fora de
 * propósito: erro de negócio é tratado dentro do caso de uso e nunca chega ao
 * adaptador, então o contador receberia quase nada e mentiria por omissão. Essa
 * quebra sai de `orders.failure_code`, que é onde o dado realmente está.
 */
@Injectable()
export class PrometheusMetrics {
  readonly registry = new Registry();

  private readonly duracaoHttp = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duracao das requisicoes HTTP em segundos',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly pedidosCriados = new Counter({
    name: 'orders_created_total',
    help: 'Pedidos aceitos pela API',
    registers: [this.registry],
  });

  private readonly pedidosProcessados = new Counter({
    name: 'orders_processed_total',
    help: 'Desfechos do processamento assincrono',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  /**
   * Só existem no papel que drena a outbox. Registradas em todo processo, a API
   * e o consumidor publicariam `outbox_pending_messages 0` para sempre — uma
   * série que parece saudável e nunca foi medida.
   */
  private readonly outboxPendente: Gauge | null;
  private readonly outboxMaisAntiga: Gauge | null;

  constructor(papel: string = 'api') {
    collectDefaultMetrics({ register: this.registry });
    const drenaAOutbox = papel === 'relay';
    this.outboxPendente = drenaAOutbox
      ? new Gauge({
          name: 'outbox_pending_messages',
          help: 'Mensagens da outbox ainda nao publicadas',
          registers: [this.registry],
        })
      : null;
    this.outboxMaisAntiga = drenaAOutbox
      ? new Gauge({
          name: 'outbox_oldest_pending_seconds',
          help: 'Idade da mensagem PENDENTE mais antiga da outbox, em segundos',
          registers: [this.registry],
        })
      : null;
  }

  observarRequisicao(method: string, route: string, status: number, duracaoMs: number): void {
    this.duracaoHttp.observe({ method, route, status: String(status) }, duracaoMs / 1000);
  }

  contarPedidoCriado(): void {
    this.pedidosCriados.inc();
  }

  contarProcessamento(resultado: ResultadoDeProcessamento): void {
    this.pedidosProcessados.inc({ outcome: resultado });
  }

  registrarOutbox(pendentes: number, idadeDaMaisAntigaSegundos: number): void {
    this.outboxPendente?.set(pendentes);
    this.outboxMaisAntiga?.set(idadeDaMaisAntigaSegundos);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
