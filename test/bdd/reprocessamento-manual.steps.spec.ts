import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { Contexto, LinhaCatalogo } from '../support/steps';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/reprocessamento-manual.feature');
const world = useWorld();

defineFeature(feature, (test) => {
  let ctx: Contexto;

  const contexto = (given: DefineStepFunction, and: DefineStepFunction): void => {
    given(/^o catálogo com os produtos:$/, async (tabela: LinhaCatalogo[]) => {
      ctx = new Contexto(world());
      await ctx.catalogo(tabela);
    });
    and(/^que estou autenticado com o papel "(.*)"$/, async (papel: string) => {
      await ctx.autenticar(papel);
    });
  };

  const pedidoFalhado = async (quantidade = '2'): Promise<string> => {
    const id = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade }]);
    await world().dataSource.query(`UPDATE products SET stock = 0 WHERE name = 'Teclado'`);
    await ctx.processar(id);
    return id;
  };

  test('Pedido FAILED volta para a fila', ({ given, and, when, then }) => {
    contexto(given, and);
    let eventIdOriginal = '';

    and(
      /^um pedido "(.*)" de "(.*)" com "(.*)" e (\d+) unidades de "(.*)"$/,
      async (_status: string, _cliente: string, _code: string, quantidade: string) => {
        await pedidoFalhado(quantidade);
        const rows = (await world().dataSource.query(
          `SELECT event_id AS eventId FROM outbox_messages ORDER BY id`,
        )) as Array<{ eventId: string }>;
        eventIdOriginal = String(rows[0]?.eventId);
      },
    );
    and(/^que o estoque de "(.*)" foi reposto para (\d+)$/, async (produto: string, estoque: string) => {
      await world().dataSource.query(`UPDATE products SET stock = ? WHERE name = ?`, [
        Number(estoque),
        produto,
      ]);
    });
    when(/^eu envio "POST \/orders\/\{id\}\/reprocess"$/, async () => {
      await ctx.post(`/orders/${ctx.pedidoId}/reprocess`, {});
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^os campos "failure_code" e "failure_reason" ficam nulos$/, async () => {
      const pedido = await world().orderById(ctx.pedidoId);
      expect(pedido.failure_code).toBeNull();
      expect(pedido.failure_reason).toBeNull();
    });
    and(/^existe uma nova linha "(.*)" em "outbox_messages" para esse pedido$/, async (status: string) => {
      expect(
        await world().countRows('outbox_messages', 'aggregate_id = ? AND status = ?', [
          ctx.pedidoId,
          status,
        ]),
      ).toBe(2);
    });
    and(/^o event_id dessa linha é diferente do event_id do evento original$/, async () => {
      // Reaproveitar o event_id faria a inbox descartar o reprocessamento em
      // silêncio: o operador clicaria e nada aconteceria.
      const rows = (await world().dataSource.query(
        `SELECT event_id AS eventId FROM outbox_messages ORDER BY id`,
      )) as Array<{ eventId: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[1]?.eventId).not.toBe(eventIdOriginal);
    });
    and(/^em até (\d+) segundos o pedido está "(.*)"$/, async (_s: string, status: string) => {
      world().ligarRelay();
      await world().ligarConsumidor();
      await ctx.esperarStatus(status);
    });
    and(/^o estoque de "(.*)" é (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
  });

  test('Só pedido FAILED pode ser reprocessado', ({ given, and, when, then }) => {
    contexto(given, and);

    and(/^um pedido de "(.*)" no status "(.*)"$/, async (_cliente: string, status: string) => {
      const id = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '1' }]);
      if (status === 'PROCESSED') await ctx.processar(id);
    });
    when(/^eu envio "POST \/orders\/\{id\}\/reprocess"$/, async () => {
      await ctx.post(`/orders/${ctx.pedidoId}/reprocess`, {});
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
    and(/^o status do pedido continua "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^nenhuma linha nova é criada em "outbox_messages"$/, async () => {
      expect(await world().countRows('outbox_messages', 'aggregate_id = ?', [ctx.pedidoId])).toBe(1);
    });
  });

  test('Dois cliques no botão de reprocessar', ({ given, and, when, then }) => {
    contexto(given, and);

    and(/^um pedido "(.*)" de "(.*)" com (\d+) unidades de "(.*)"$/, async () => {
      await pedidoFalhado();
    });
    when(/^eu envio "POST \/orders\/\{id\}\/reprocess" (\d+) vezes em paralelo$/, async () => {
      // A guarda real é o affectedRows do UPDATE condicional — e ela só pode ser
      // provada com duas requisições de verdade contra o MySQL.
      const id = ctx.pedidoId;
      ctx.respostas = [];
      await Promise.all([
        ctx.post(`/orders/${id}/reprocess`, {}),
        ctx.post(`/orders/${id}/reprocess`, {}),
      ]);
    });
    then(/^exatamente (\d+) resposta tem status (\d+)$/, (quantidade: string, status: string) => {
      expect(ctx.respostas.filter((r) => r.status === Number(status))).toHaveLength(
        Number(quantidade),
      );
    });
    and(/^exatamente (\d+) resposta tem status (\d+)$/, (quantidade: string, status: string) => {
      expect(ctx.respostas.filter((r) => r.status === Number(status))).toHaveLength(
        Number(quantidade),
      );
    });
    and(/^existe exatamente (\d+) linha nova em "outbox_messages" para esse pedido$/, async () => {
      expect(await world().countRows('outbox_messages', 'aggregate_id = ?', [ctx.pedidoId])).toBe(2);
    });
  });

  test('Reprocessar um pedido que já tinha reservado estoque não decrementa de novo', ({
    given,
    and,
    when,
    then,
  }) => {
    contexto(given, and);

    and(/^um pedido "(.*)" de "(.*)" que já possui reserva de (\d+) unidades de "(.*)"$/, async () => {
      // Pedido processado (reserva criada) e depois forçado a FAILED: o estado
      // que o operador encontra quando algo deu errado DEPOIS da reserva.
      const id = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '2' }]);
      await ctx.processar(id);
      await world().dataSource.query(
        `UPDATE orders SET status = 'FAILED', failure_code = 'RETRIES_EXHAUSTED',
           failure_reason = 'forcado no cenario', processed_at = NULL WHERE id = ?`,
        [id],
      );
    });
    and(/^o estoque de "(.*)" em (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    when(/^eu envio "POST \/orders\/\{id\}\/reprocess"$/, async () => {
      await ctx.post(`/orders/${ctx.pedidoId}/reprocess`, {});
      expect(ctx.resposta?.status).toBe(202);
    });
    and(/^o consumidor processa o novo evento$/, async () => {
      await ctx.processar(ctx.pedidoId, { eventId: Contexto.novoId() });
    });
    then(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      // A terceira camada de idempotência em ação: o reprocessamento fura a
      // inbox e a checagem de estado, e ainda assim não decrementa de novo.
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^existe exatamente (\d+) linha em "stock_reservations" para esse pedido$/, async (n: string) => {
      expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(
        Number(n),
      );
    });
  });

  test('Reprocessar é ação de operador', ({ given, and, when, then }) => {
    contexto(given, and);

    and(/^um pedido "(.*)" de "(.*)"$/, async () => {
      await pedidoFalhado();
    });
    and(/^que estou autenticado com o papel "(.*)"$/, async (papel: string) => {
      await ctx.autenticar(papel);
    });
    when(/^eu envio "POST \/orders\/\{id\}\/reprocess"$/, async () => {
      await ctx.post(`/orders/${ctx.pedidoId}/reprocess`, {});
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      // 403 e não 401: o sistema sabe quem é, e essa pessoa não pode.
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o status do pedido continua "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
  });

  test('Reprocessar pedido inexistente', ({ given, and, when, then }) => {
    contexto(given, and);

    when(/^eu envio "POST \/orders\/(.*)\/reprocess"$/, async (id: string) => {
      await ctx.post(`/orders/${id}/reprocess`, {});
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
  });
});
