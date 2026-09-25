import { Env } from '../../src/infrastructure/config/env.schema';
import { PrometheusMetrics } from '../../src/infrastructure/observability/prometheus.metrics';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';
import { PendingMessage } from '../../src/infrastructure/persistence/outbox/outbox-dispatch.repository';
import { RelayWorker } from '../../src/workers/relay/relay.worker';
import { FixedClock } from '../support/in-memory';

const mensagem = (id: number): PendingMessage => ({
  id,
  eventId: `evt-${id}`,
  eventName: 'order.created',
  payload: { orderId: `order-${id}`, correlationId: `corr-${id}` },
  attempts: 0,
});

const montar = (lotes: PendingMessage[][] = [[]]) => {
  let ciclo = 0;
  const outbox = {
    claimBatch: jest.fn(async () => lotes[Math.min(ciclo++, lotes.length - 1)] ?? []),
    markPublished: jest.fn(async () => undefined),
    markRetry: jest.fn(async () => undefined),
    pendingStats: jest.fn(async () => ({ pendentes: 0, idadeDaMaisAntigaSegundos: 0 })),
  };
  const publisher = { publishCreated: jest.fn(async () => undefined) };
  const outboxRetention = { purgePublishedBefore: jest.fn(async (_corte: Date) => 0) };
  const inboxRetention = { purgeProcessedBefore: jest.fn(async (_corte: Date) => 0) };
  const env = {
    outboxBatchSize: 50,
    outboxPollIntervalMs: 5,
    maxPublishAttempts: 10,
    retentionDays: 30,
  } as unknown as Env;
  return {
    outbox,
    publisher,
    outboxRetention,
    inboxRetention,
    worker: new RelayWorker(
      outbox as never,
      outboxRetention as never,
      inboxRetention as never,
      publisher as never,
      new FixedClock(),
      env,
      new StructuredLogger('silent', 'test'),
      new PrometheusMetrics('relay'),
    ),
  };
};

describe('RelayWorker', () => {
  it('um ciclo sem trabalho não publica nada e não marca nada', async () => {
    const { worker, outbox, publisher } = montar([[]]);
    expect(await worker.drainOnce()).toBe(0);
    expect(publisher.publishCreated).not.toHaveBeenCalled();
    expect(outbox.markPublished).not.toHaveBeenCalled();
  });

  it('publica o lote e só então marca como PUBLISHED', async () => {
    const { worker, outbox, publisher } = montar([[mensagem(1), mensagem(2)]]);

    expect(await worker.drainOnce()).toBe(2);

    expect(publisher.publishCreated).toHaveBeenCalledTimes(2);
    expect(outbox.markPublished).toHaveBeenCalledWith([1, 2], expect.any(Date));
    // A ordem importa: marcar antes de publicar perderia silenciosamente tudo o
    // que estivesse em voo quando o broker caísse.
    const ordemPublicacao = publisher.publishCreated.mock.invocationCallOrder[0] ?? 0;
    const ordemMarcacao = outbox.markPublished.mock.invocationCallOrder[0] ?? 0;
    expect(ordemPublicacao).toBeLessThan(ordemMarcacao);
  });

  it('falha ao publicar não marca PUBLISHED e agenda nova tentativa', async () => {
    const { worker, outbox, publisher } = montar([[mensagem(1)]]);
    publisher.publishCreated.mockRejectedValueOnce(new Error('ECONNREFUSED no broker'));

    expect(await worker.drainOnce()).toBe(0);

    expect(outbox.markPublished).toHaveBeenCalledWith([], expect.any(Date));
    expect(outbox.markRetry).toHaveBeenCalledWith(
      1,
      'ECONNREFUSED no broker',
      expect.any(Date),
      10,
    );
  });

  it('no lote misto, publica o que deu e retenta só o que falhou', async () => {
    const { worker, outbox, publisher } = montar([[mensagem(1), mensagem(2), mensagem(3)]]);
    publisher.publishCreated.mockImplementationOnce(async () => undefined);
    publisher.publishCreated.mockRejectedValueOnce(new Error('falhou a 2'));

    expect(await worker.drainOnce()).toBe(2);

    expect(outbox.markPublished).toHaveBeenCalledWith([1, 3], expect.any(Date));
    expect(outbox.markRetry).toHaveBeenCalledTimes(1);
  });

  it('o backoff cresce com o número de tentativas e tem teto', async () => {
    // Sem teto, a décima tentativa cairia daqui a 17 minutos e a mensagem
    // pareceria perdida.
    const { worker, outbox, publisher } = montar([
      [{ ...mensagem(1), attempts: 0 }, { ...mensagem(2), attempts: 3 }, { ...mensagem(3), attempts: 20 }],
    ]);
    publisher.publishCreated.mockRejectedValue(new Error('broker fora'));

    await worker.drainOnce();

    const agora = new FixedClock().now().getTime();
    const atrasos = (outbox.markRetry.mock.calls as unknown as Array<[number, string, Date, number]>)
      .map(([, , quando]) => quando.getTime() - agora);
    expect(atrasos[0]).toBe(1_000);
    expect(atrasos[1]).toBe(8_000);
    expect(atrasos[2]).toBe(60_000);
  });

  it('mensagem sem correlationId no payload é publicada mesmo assim', async () => {
    // Perder o rastro é ruim; perder a mensagem é pior. A publicação não pode
    // depender de um campo de observabilidade.
    const { worker, publisher } = montar([[{ ...mensagem(1), payload: { orderId: 'order-1' } }]]);
    expect(await worker.drainOnce()).toBe(1);
    expect(publisher.publishCreated).toHaveBeenCalledWith({ orderId: 'order-1' }, '');
  });

  it('o laço contínuo drena, sobrevive a erro de ciclo e para no shutdown', async () => {
    const { worker, outbox } = montar([[mensagem(1)], []]);
    outbox.claimBatch.mockRejectedValueOnce(new Error('MySQL fora'));

    worker.start();
    worker.start(); // idempotente: chamar duas vezes não cria dois laços
    await new Promise((resolve) => setTimeout(resolve, 60));
    await worker.onApplicationShutdown();

    // Um erro no ciclo não pode matar o relay: ele registra e tenta de novo.
    expect(outbox.claimBatch.mock.calls.length).toBeGreaterThan(1);
  });

  describe('expurgo de histórico', () => {
    it('corta pelo prazo de retenção configurado', async () => {
      const { worker, outboxRetention, inboxRetention } = montar([[]]);

      await worker.expurgarSeChegouAHora();

      const esperado = new FixedClock().now().getTime() - 30 * 24 * 60 * 60 * 1000;
      expect(outboxRetention.purgePublishedBefore).toHaveBeenCalledWith(new Date(esperado));
      expect(inboxRetention.purgeProcessedBefore).toHaveBeenCalledWith(new Date(esperado));
    });

    // A cada 500 ms o expurgo viraria carga constante no banco em vez de
    // limpeza de rotina. O relógio é fixo no teste, então a segunda chamada
    // acontece "no mesmo instante" — e tem que ser ignorada.
    // Sem apagar nada, o relay fica calado: uma linha por hora dizendo "0 e 0"
    // é ruído que treina quem opera a ignorar o log do expurgo.
    it('registra uma linha só quando houve o que apagar', async () => {
      const { worker, outboxRetention, inboxRetention } = montar([[]]);
      outboxRetention.purgePublishedBefore.mockResolvedValueOnce(7);
      inboxRetention.purgeProcessedBefore.mockResolvedValueOnce(3);
      const log = jest.spyOn(StructuredLogger.prototype, 'log').mockImplementation(() => undefined);

      await worker.expurgarSeChegouAHora();

      expect(log).toHaveBeenCalledWith(
        'Expurgo de histórico concluído',
        expect.objectContaining({ outbox: 7, inbox: 3 }),
      );
      log.mockRestore();
    });

    it('não registra nada quando não havia o que apagar', async () => {
      const { worker } = montar([[]]);
      const log = jest.spyOn(StructuredLogger.prototype, 'log').mockImplementation(() => undefined);

      await worker.expurgarSeChegouAHora();

      expect(log).not.toHaveBeenCalledWith('Expurgo de histórico concluído', expect.anything());
      log.mockRestore();
    });

    it('não repete antes da hora', async () => {
      const { worker, outboxRetention } = montar([[]]);

      await worker.expurgarSeChegouAHora();
      await worker.expurgarSeChegouAHora();
      await worker.expurgarSeChegouAHora();

      expect(outboxRetention.purgePublishedBefore).toHaveBeenCalledTimes(1);
    });
  });
});
