import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { Contexto, LinhaCatalogo, LinhaItem } from '../support/steps';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/processamento-assincrono.feature');
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

  test('Pedido pendente vira PROCESSED e reserva o estoque', ({ given, and, when, then }) => {
    catalogo(given);

    and(
      /^um pedido PENDING de "(.*)" com (\d+) unidades de "(.*)"$/,
      async (cliente: string, quantidade: string, produto: string) => {
        await ctx.criarPedido(cliente, [{ produto, quantidade }]);
      },
    );
    and(/^o evento "(.*)" desse pedido publicado na fila$/, async () => {
      await ctx.publicar();
    });
    when(/^o consumidor processa a mensagem$/, async () => {
      await world().ligarConsumidor();
      await ctx.esperarStatus('PROCESSED');
    });
    then(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o estoque de "(.*)" é (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(
      /^existe (\d+) linha em "stock_reservations" para esse pedido com quantidade (\d+)$/,
      async (linhas: string, quantidade: string) => {
        expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(
          Number(linhas),
        );
        expect(await world().sumReservations(ctx.pedidoId)).toBe(Number(quantidade));
      },
    );
    and(/^o campo "processed_at" do pedido está preenchido$/, async () => {
      expect((await world().orderById(ctx.pedidoId)).processed_at).not.toBeNull();
    });
    and(/^os campos "failure_code" e "failure_reason" estão nulos$/, async () => {
      const pedido = await world().orderById(ctx.pedidoId);
      expect(pedido.failure_code).toBeNull();
      expect(pedido.failure_reason).toBeNull();
    });
  });

  test('Pedido com vários itens reserva todos ou nenhum', ({ given, and, when, then }) => {
    catalogo(given);

    and(/^um pedido PENDING de "(.*)" com:$/, async (cliente: string, itens: LinhaItem[]) => {
      await ctx.criarPedido(cliente, itens);
    });
    when(/^o consumidor processa a mensagem$/, async () => {
      await ctx.processar();
    });
    then(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o motivo salvo é "(.*)"$/, async (motivo: string) => {
      expect((await world().orderById(ctx.pedidoId)).failure_reason).toBe(motivo);
    });
    and(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^não existe nenhuma linha em "stock_reservations" para esse pedido$/, async () => {
      expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(0);
    });
  });

  test('O POST responde antes de o processamento terminar', ({ given, when, then, and }) => {
    catalogo(given);
    let duracaoDoPost = 0;
    let duracaoAteConcluir = 0;
    let statusNaResposta = '';

    when(/^eu envio um pedido válido de "(.*)"$/, async (cliente: string) => {
      const inicio = Date.now();
      const resposta = await ctx.post('/orders', ctx.corpoPadrao(cliente));
      duracaoDoPost = Date.now() - inicio;
      statusNaResposta = String((resposta.body as { status?: string }).status);

      world().ligarRelay();
      await world().ligarConsumidor();
      await ctx.esperarStatus('PROCESSED');
      duracaoAteConcluir = Date.now() - inicio;
    });
    then(/^o pedido está "(.*)" no instante da resposta$/, (status: string) => {
      expect(statusNaResposta).toBe(status);
    });
    and(/^em até (\d+) segundos o pedido está "(.*)"$/, async (_s: string, status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^a resposta do POST levou uma fração do tempo até a conclusão$/, () => {
      expect(duracaoDoPost * 3).toBeLessThan(duracaoAteConcluir);
    });
  });

  test('A criação não chama a lógica de processamento', ({ given, when, then, and }) => {
    catalogo(given);

    when(/^eu envio um pedido válido de "(.*)" com o consumidor parado$/, async (cliente: string) => {
      await world().desligarConsumidor();
      await ctx.post('/orders', ctx.corpoPadrao(cliente));
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o pedido fica "(.*)" indefinidamente$/, async (status: string) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    when(/^o consumidor volta a rodar$/, async () => {
      world().ligarRelay();
      await world().ligarConsumidor();
    });
    then(/^em até (\d+) segundos o pedido está "(.*)"$/, async (_s: string, status: string) => {
      await ctx.esperarStatus(status);
    });
  });

  test('Crash entre o COMMIT e o ack não duplica o efeito', ({ given, and, when, then }) => {
    catalogo(given);

    and(
      /^um pedido PENDING de "(.*)" com (\d+) unidades de "(.*)"$/,
      async (cliente: string, quantidade: string, produto: string) => {
        await ctx.criarPedido(cliente, [{ produto, quantidade }]);
      },
    );
    and(/^que o consumidor vai morrer logo depois do COMMIT, antes do ack$/, async () => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe('PENDING');
      expect(await world().countRows('inbox_messages', 'order_id = ?', [ctx.pedidoId])).toBe(0);
    });
    when(/^o consumidor processa a mensagem e é reiniciado$/, async () => {
      const eventId = Contexto.novoId();
      await ctx.processar(ctx.pedidoId, { eventId });
      await ctx.processar(ctx.pedidoId, { eventId });
    });
    then(/^o estoque de "(.*)" é (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^existe exatamente (\d+) linha em "stock_reservations" para esse pedido$/, async (linhas: string) => {
      expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(
        Number(linhas),
      );
    });
    and(/^o pedido está "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
  });
});
