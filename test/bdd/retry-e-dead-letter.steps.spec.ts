import { LOGGER } from '../../src/infrastructure/observability/correlation.constants';
import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { OrderPublisher } from '../../src/infrastructure/messaging/orders/order.publisher';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';
import { TransientError } from '../../src/domain/shared/errors';
import { Contexto, LinhaCatalogo } from '../support/steps';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/retry-e-dead-letter.feature');
const world = useWorld();

defineFeature(feature, (test) => {
  let ctx: Contexto;
  let retentativas: number[];
  let espiaoRetry: jest.SpyInstance;
  let espiaoErro: jest.SpyInstance;

  const catalogo = (given: DefineStepFunction): void => {
    given(/^o catálogo com os produtos:$/, async (tabela: LinhaCatalogo[]) => {
      ctx = new Contexto(world());
      await ctx.catalogo(tabela);
      await ctx.autenticar('CUSTOMER');
      retentativas = [];
      espiaoErro = jest.spyOn(world().app.get<StructuredLogger>(LOGGER), 'error');
      espiaoRetry = jest
        .spyOn(world().publisher, 'publishRetry')
        .mockImplementation(async function (this: OrderPublisher, ...args) {
          retentativas.push(args[2]);
          return OrderPublisher.prototype.publishRetry.apply(world().publisher, args);
        });
    });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('customerName com "fail" esgota as tentativas e vai para a dead-letter', ({
    given,
    and,
    when,
    then,
  }) => {
    catalogo(given);

    and(
      /^um pedido PENDING de "(.*)" com (\d+) unidade de "(.*)"$/,
      async (cliente: string, quantidade: string, produto: string) => {
        await ctx.criarPedido(cliente, [{ produto, quantidade }]);
      },
    );
    when(/^o consumidor processa a mensagem até esgotar as tentativas$/, async () => {
      await world().ligarConsumidor();
      await ctx.publicar();
      await ctx.esperarStatus('FAILED');
    });
    then(/^foram observadas exatamente (\d+) tentativas de processamento$/, (total: string) => {
      expect(retentativas.length + 1).toBe(Number(total));
    });
    and(/^a mensagem passou pelos (\d+) degraus de espera, na ordem$/, (degraus: string) => {
      expect(retentativas).toEqual([2, 3, 4].slice(0, Number(degraus)));
      expect(espiaoRetry).toHaveBeenCalledTimes(Number(degraus));
    });
    and(/^existe (\d+) mensagem na fila "(.*)"$/, async (n: string, fila: string) => {
      expect(await world().queueDepth(fila)).toBe(Number(n));
    });
    and(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o campo "failure_code" é "(.*)"$/, async (code: string) => {
      expect((await world().orderById(ctx.pedidoId)).failure_code).toBe(code);
    });
    and(/^o campo "failure_reason" contém a mensagem real do erro$/, async () => {
      expect((await world().orderById(ctx.pedidoId)).failure_reason).toContain('Falha simulada');
    });
    and(/^o campo "processing_attempts" do pedido é (\d+)$/, async (n: string) => {
      expect(Number((await world().orderById(ctx.pedidoId)).processing_attempts)).toBe(Number(n));
    });
    and(/^o estoque de "(.*)" continua (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
  });

  test('Erro transitório que passa na segunda tentativa', ({ given, and, when, then }) => {
    catalogo(given);

    and(
      /^um pedido PENDING de "(.*)" com (\d+) unidade de "(.*)"$/,
      async (cliente: string, quantidade: string, produto: string) => {
        await ctx.criarPedido(cliente, [{ produto, quantidade }]);
      },
    );
    and(/^que a primeira tentativa vai falhar com "(.*)"$/, (codigo: string) => {
      const real = world().processOrder.execute.bind(world().processOrder);
      jest
        .spyOn(world().processOrder, 'execute')
        .mockImplementationOnce(async () => {
          throw new TransientError(`MySQL ${codigo}`);
        })
        .mockImplementation(real);
    });
    when(/^o consumidor processa a mensagem$/, async () => {
      await world().ligarConsumidor();
      await ctx.publicar();
      await ctx.esperarStatus('PROCESSED');
    });
    then(/^a mensagem é retentada (\d+) vez$/, (n: string) => {
      expect(retentativas).toHaveLength(Number(n));
    });
    and(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o estoque de "(.*)" é (\d+)$/, async (produto: string, estoque: string) => {
      expect(await world().stockOf(produto)).toBe(Number(estoque));
    });
    and(/^não há mensagem na fila "(.*)"$/, async (fila: string) => {
      expect(await world().queueDepth(fila)).toBe(0);
    });
    and(/^existe exatamente (\d+) linha em "stock_reservations" para esse pedido$/, async (n: string) => {
      // A retentativa não pode ter decrementado duas vezes.
      expect(await world().countRows('stock_reservations', 'order_id = ?', [ctx.pedidoId])).toBe(
        Number(n),
      );
    });
  });

  test('Erro de negócio falha de imediato, sem retry e sem dead-letter', ({
    given,
    and,
    when,
    then,
  }) => {
    catalogo(given);

    and(/^um pedido PENDING cujo estoque não cobre a quantidade pedida$/, async () => {
      // Falha REAL: quantidade maior que o estoque semeado. Antes este cenário
      // tinha um segundo exemplo, "produto não encontrado", que só funcionava
      // com o caso de uso mockado — e mockado ele ia para a dead-letter,
      // contradizendo o próprio cenário. Saiu porque é impossível: a FK
      // `ON DELETE RESTRICT` impede que um produto referenciado suma.
      await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '9' }]);
    });
    when(/^o consumidor processa a mensagem$/, async () => {
      await world().ligarConsumidor();
      await ctx.publicar();
      await ctx.esperarStatus('FAILED');
    });
    then(/^o pedido fica com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^o campo "failure_code" é "(.*)"$/, async (code: string) => {
      expect((await world().orderById(ctx.pedidoId)).failure_code).toBe(code);
    });
    and(/^foi observada exatamente (\d+) tentativa$/, (n: string) => {
      expect(retentativas.length + 1).toBe(Number(n));
    });
    and(/^não há mensagem na fila "(.*)"$/, async (fila: string) => {
      // Sem válvula de escape: este É o ponto do cenário. Erro de negócio é
      // confirmado e encerra — não vai para a dead-letter, que existe para o
      // que ninguém sabe tratar.
      expect(await world().queueDepth(fila)).toBe(0);
    });
  });

  test('Payload corrompido vai direto para a dead-letter', ({ given, when, then, and }) => {
    catalogo(given);

    when(/^chega na fila "(.*)" uma mensagem com JSON inválido$/, async (fila: string) => {
      await world().ligarConsumidor();
      await world().publicarBruto(fila, Buffer.from('{ isto nao e json'));
      await world().waitFor('mensagem morta', async () =>
        (await world().queueDepth('orders.dead')) > 0 ? true : null,
      );
    });
    then(/^a mensagem vai para "(.*)" sem nenhuma retentativa$/, async (fila: string) => {
      // Retentar não conserta byte quebrado: 3 retentativas gastariam 65s para
      // chegar exatamente no mesmo lugar.
      expect(await world().queueDepth(fila)).toBe(1);
      expect(retentativas).toHaveLength(0);
    });
    and(/^um log de nível "(.*)" é emitido com o event_id da mensagem$/, (nivel: string) => {
      expect(nivel).toBe('error');
      expect(espiaoErro).toHaveBeenCalledWith(
        'Mensagem ilegivel na fila',
        expect.objectContaining({ erro: expect.any(String) }),
      );
    });
    and(/^nenhum pedido é alterado$/, async () => {
      expect(await world().countRows('orders', "status <> 'PENDING'")).toBe(0);
    });
  });

  test('Evento de um pedido que não existe no banco', ({ given, when, then, and }) => {
    catalogo(given);

    when(/^chega um evento "(.*)" para um orderId inexistente$/, async () => {
      await world().ligarConsumidor();
      await ctx.publicar(Contexto.novoId());
      await world().waitFor('mensagem morta', async () =>
        (await world().queueDepth('orders.dead')) > 0 ? true : null,
      );
    });
    then(/^a mensagem vai para "(.*)"$/, async (fila: string) => {
      expect(await world().queueDepth(fila)).toBe(1);
    });
    and(/^um log de nível "(.*)" é emitido com o orderId$/, (nivel: string) => {
      // Sem o orderId no log, "evento de pedido inexistente" é uma linha que não
      // permite descobrir QUAL pedido — inútil no plantão.
      expect(nivel).toBe('error');
      expect(espiaoErro).toHaveBeenCalledWith(
        'Evento sem pedido correspondente',
        expect.objectContaining({ eventId: expect.any(String) }),
      );
    });
    and(/^nenhuma linha é criada em "(.*)"$/, async (tabela: string) => {
      expect(await world().countRows(tabela)).toBe(0);
    });
  });

  test('Erro desconhecido é tratado como transitório', ({ given, and, when, then }) => {
    catalogo(given);

    and(
      /^um pedido PENDING de "(.*)" com (\d+) unidade de "(.*)"$/,
      async (cliente: string, quantidade: string, produto: string) => {
        await ctx.criarPedido(cliente, [{ produto, quantidade }]);
      },
    );
    and(/^que o processamento vai lançar um erro não catalogado$/, () => {
      jest.spyOn(world().processOrder, 'execute').mockImplementation(async () => {
        throw new TypeError('algo que ninguem previu');
      });
    });
    when(/^o consumidor processa a mensagem até esgotar as tentativas$/, async () => {
      await world().ligarConsumidor();
      await ctx.publicar();
      await world().waitFor('mensagem morta', async () =>
        (await world().queueDepth('orders.dead')) > 0 ? true : null,
      );
    });
    then(/^a mensagem foi retentada (\d+) vezes antes da dead-letter$/, (n: string) => {
      // O default seguro: desistir de um transitório custa o pedido; retentar um
      // definitivo custa três tentativas.
      expect(retentativas).toHaveLength(Number(n));
    });
    and(/^o pedido fica com status "(.*)" com "(.*)"$/, async (status: string, code: string) => {
      const pedido = await world().orderById(ctx.pedidoId);
      expect(pedido.status).toBe(status);
      expect(pedido.failure_code).toBe(code);
    });
  });

  test('A dead-letter preserva o que o plantão precisa', ({ given, and, then }) => {
    catalogo(given);
    let morta: { headers: Record<string, unknown>; payload: Record<string, unknown> } | null = null;

    and(/^uma mensagem na fila "(.*)"$/, async () => {
      await ctx.criarPedido('Cliente fail teste', [{ produto: 'Teclado', quantidade: '1' }]);
      await world().ligarConsumidor();
      await ctx.publicar();
      await ctx.esperarStatus('FAILED');
      morta = await world().firstMessageOf('orders.dead');
    });
    then(/^a mensagem carrega o header "(.*)" com valor (\d+)$/, (header: string, valor: string) => {
      expect(Number(morta?.headers[header])).toBe(Number(valor));
    });
    and(/^carrega o header "(.*)" do pedido original$/, (header: string) => {
      expect(String(morta?.headers[header])).toBe(ctx.correlationId);
    });
    and(/^carrega o header "(.*)" com a mensagem do último erro$/, (header: string) => {
      expect(String(morta?.headers[header])).toContain('Falha simulada');
    });
    and(/^o payload original está intacto$/, () => {
      expect(morta?.payload['orderId']).toBe(ctx.pedidoId);
      expect(morta?.payload['eventName']).toBe('order.created');
    });
  });
});
