import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { Contexto, LinhaCatalogo } from '../support/steps';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/estoque-reserva.feature');
const world = useWorld();

defineFeature(feature, (test) => {
  let ctx: Contexto;

  const catalogo = (given: DefineStepFunction): void => {
    given(/^o catálogo com os produtos:$/, async (tabela: LinhaCatalogo[]) => {
      ctx = new Contexto(world());
      await ctx.catalogo(tabela);
      await ctx.autenticar('CUSTOMER');
    });
  };

  const pedidoPendente = (and: DefineStepFunction): void => {
    and(
      /^um pedido PENDING de "(.*)" com (\d+) unidades de "(.*)"$/,
      async (cliente: string, quantidade: string, produto: string) => {
        await ctx.criarPedido(cliente, [{ produto, quantidade }]);
      },
    );
  };

  test('Estoque insuficiente reprova o pedido sem mexer no catálogo', ({
    given,
    and,
    when,
    then,
  }) => {
    catalogo(given);
    pedidoPendente(and);

    when(/^o consumidor processa a mensagem$/, async () => {
      expect(await ctx.processar()).toBe('FAILED');
    });
    then(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o campo "failure_code" é "(.*)"$/, async (code: string) => {
      expect((await world().orderById(ctx.pedidoId)).failure_code).toBe(code);
    });
    and(/^o campo "failure_reason" é "(.*)"$/, async (motivo: string) => {
      expect((await world().orderById(ctx.pedidoId)).failure_reason).toBe(motivo);
    });
    and(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^não existe nenhuma linha em "stock_reservations" para esse pedido$/, async () => {
      expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(0);
    });
    and(/^a mensagem é confirmada sem retry e sem dead-letter$/, async () => {
      expect(await world().queueDepth('orders.dead')).toBe(0);
    });
  });

  test('A borda exata do estoque', ({ given, and, when, then }) => {
    catalogo(given);
    pedidoPendente(and);

    when(/^o consumidor processa a mensagem$/, async () => {
      await ctx.processar();
    });
    then(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o estoque de "(.*)" é (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
  });

  test('Reentrega da mesma mensagem não decrementa duas vezes', ({ given, and, when, then }) => {
    catalogo(given);
    pedidoPendente(and);
    let eventId = '';
    let resultadoDaReentrega = '';

    and(/^o evento "(.*)" desse pedido já processado com sucesso$/, async () => {
      eventId = Contexto.novoId();
      expect(await ctx.processar(ctx.pedidoId, { eventId })).toBe('PROCESSED');
    });
    when(/^a mesma mensagem, com o mesmo event_id, é entregue de novo$/, async () => {
      resultadoDaReentrega = await ctx.processar(ctx.pedidoId, { eventId });
    });
    then(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^existe exatamente (\d+) linha em "stock_reservations" para esse pedido$/, async (n: string) => {
      expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(
        Number(n),
      );
    });
    and(/^o pedido continua "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^a segunda entrega é confirmada sem erro$/, () => {
      expect(resultadoDaReentrega).toBe('DUPLICATE');
    });
  });

  test('A constraint segura mesmo sem a inbox', ({ given, and, when, then }) => {
    catalogo(given);
    pedidoPendente(and);

    and(/^o evento desse pedido já processado com sucesso$/, async () => {
      await ctx.processar();
    });
    and(/^que a inbox foi limpa manualmente$/, async () => {
      await world().dataSource.query('DELETE FROM inbox_messages');
    });
    and(/^que o pedido foi devolvido para "(.*)" manualmente$/, async (status: string) => {
      await world().dataSource.query(
        `UPDATE orders SET status = ?, processed_at = NULL WHERE id = ?`,
        [status, ctx.pedidoId],
      );
    });
    when(/^a mesma mensagem é entregue de novo$/, async () => {
      await ctx.processar(ctx.pedidoId, { eventId: Contexto.novoId() });
    });
    then(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(
      /^a transação foi revertida por violação de "(.*)"$/,
      async (constraint: string) => {
        expect(constraint).toBe('uq_stock_reservations_order_product');
        expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(1);
      },
    );
  });
});
