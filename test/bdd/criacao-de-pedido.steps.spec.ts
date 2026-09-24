import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { Contexto, LinhaCatalogo } from '../support/steps';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/criacao-de-pedido.feature');
const world = useWorld();

defineFeature(feature, (test) => {
  let ctx: Contexto;

  const contexto = ({ given, and }: { given: DefineStepFunction; and: DefineStepFunction }): void => {
    given(/^o catálogo com os produtos:$/, async (tabela: LinhaCatalogo[]) => {
      ctx = new Contexto(world());
      await ctx.catalogo(tabela);
    });
    and(/^que estou autenticado com o papel "(.*)"$/, async (papel: string) => {
      await ctx.autenticar(papel);
    });
  };

  test('Pedido com dois itens calcula o total e nasce PENDING', ({ given, and, when, then }) => {
    contexto({ given, and });

    when(/^eu envio "POST \/orders" com o corpo:$/, async (corpo: string) => {
      await ctx.post('/orders', JSON.parse(corpo));
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "(.*)" da resposta é "(.*)"$/, (campo: string, valor: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toBe(valor);
    });
    and(/^o campo "(.*)" da resposta é "(.*)"$/, (campo: string, valor: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toBe(valor);
    });
    and(/^o pedido devolvido existe na tabela "orders" com status "(.*)"$/, async (status: string) => {
      expect((await world().orderById(ctx.pedidoId)).status).toBe(status);
    });
    and(/^a tabela "order_items" tem (\d+) linhas para esse pedido$/, async (quantidade: string) => {
      expect(await world().countRows('order_items', 'order_id = ?', [ctx.pedidoId])).toBe(
        Number(quantidade),
      );
    });
    and(/^a resposta traz o header "(.*)"$/, (header: string) => {
      expect(ctx.resposta?.headers[header]).toBeDefined();
    });
  });

  test('Pedido e evento nascem na mesma transação', ({ given, and, when, then }) => {
    contexto({ given, and });

    when(/^eu envio um pedido válido de "(.*)"$/, async (cliente: string) => {
      await ctx.criarPedido(cliente);
    });
    then(
      /^existe exatamente (\d+) linha em "outbox_messages" com event_name "(.*)"$/,
      async (quantidade: string, eventName: string) => {
        expect(await world().countRows('outbox_messages', 'event_name = ?', [eventName])).toBe(
          Number(quantidade),
        );
      },
    );
    and(/^essa linha está com status "(.*)"$/, async (status: string) => {
      expect(await world().countRows('outbox_messages', 'status = ?', [status])).toBe(1);
    });
    and(/^o "correlationId" do payload é igual ao "correlation_id" do pedido$/, async () => {
      const rows = (await world().dataSource.query(
        `SELECT payload->>'$.correlationId' AS correlationId FROM outbox_messages`,
      )) as Array<{ correlationId: string }>;
      const pedido = await world().orderById(ctx.pedidoId);
      expect(rows[0]?.correlationId).toBe(pedido.correlation_id);
    });
    and(/^o evento é versionado, com "eventName" e "version" explícitos$/, async () => {
      const rows = (await world().dataSource.query(
        `SELECT payload->>'$.eventName' AS eventName, payload->>'$.version' AS version
           FROM outbox_messages`,
      )) as Array<{ eventName: string; version: string }>;
      expect(rows[0]).toEqual({ eventName: 'order.created', version: '1' });
    });
  });

  test('Falha ao gravar o evento não pode deixar pedido órfão', ({ given, and, when, then }) => {
    contexto({ given, and });

    given(/^que o INSERT em "outbox_messages" vai falhar$/, async () => {
      await world().dataSource.query(
        `ALTER TABLE outbox_messages ADD CONSTRAINT ck_forcar_falha CHECK (event_name = 'jamais')`,
      );
    });
    when(/^eu envio um pedido válido de "(.*)"$/, async (cliente: string) => {
      await ctx.post('/orders', ctx.corpoPadrao(cliente));
      await world().dataSource.query(
        'ALTER TABLE outbox_messages DROP CONSTRAINT ck_forcar_falha',
      );
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^a tabela "orders" continua vazia$/, async () => {
      expect(await world().countRows('orders')).toBe(0);
    });
    and(/^a tabela "order_items" continua vazia$/, async () => {
      expect(await world().countRows('order_items')).toBe(0);
    });
  });

  test('O total é somado em decimal, nunca em ponto flutuante', ({ given, and, when, then }) => {
    contexto({ given, and });

    when(
      /^eu envio um pedido com um item "(.*)" de quantidade (\d+) e preço "(.*)"$/,
      async (produto: string, quantidade: string, preco: string) => {
        await ctx.post('/orders', {
          customerName: 'Ana Souza',
          items: [{ productName: produto, quantity: Number(quantidade), price: preco }],
        });
      },
    );
    then(/^o campo "(.*)" da resposta é "(.*)"$/, (campo: string, valor: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toBe(valor);
    });
  });

  test('Entrada inválida é recusada antes de tocar no banco', ({ given, and, when, then }) => {
    contexto({ given, and });

    const CORPOS: Record<string, unknown> = {
      'lista de itens vazia': { customerName: 'Ana Souza', items: [] },
      'um item com quantidade 0': {
        customerName: 'Ana Souza',
        items: [{ productName: 'Teclado', quantity: 0, price: '10.00' }],
      },
      'um item com quantidade negativa': {
        customerName: 'Ana Souza',
        items: [{ productName: 'Teclado', quantity: -2, price: '10.00' }],
      },
      'um item com preço negativo': {
        customerName: 'Ana Souza',
        items: [{ productName: 'Teclado', quantity: 1, price: '-10.00' }],
      },
      'customerName vazio': {
        customerName: '',
        items: [{ productName: 'Teclado', quantity: 1, price: '10.00' }],
      },
      'customerName com 300 caracteres': {
        customerName: 'x'.repeat(300),
        items: [{ productName: 'Teclado', quantity: 1, price: '10.00' }],
      },
      'um produto que não existe no catálogo': {
        customerName: 'Ana Souza',
        items: [{ productName: 'Produto Fantasma', quantity: 1, price: '10.00' }],
      },
    };

    when(/^eu envio "POST \/orders" com (.*)$/, async (caso: string) => {
      const corpo = CORPOS[caso.trim()];
      expect(corpo).toBeDefined();
      await ctx.post('/orders', corpo);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
    and(/^a tabela "orders" continua vazia$/, async () => {
      expect(await world().countRows('orders')).toBe(0);
    });
  });

  test('O correlation ID enviado pelo cliente é respeitado', ({ given, and, when, then }) => {
    contexto({ given, and });

    when(
      /^eu envio um pedido válido com o header "(.*)" igual a "(.*)"$/,
      async (header: string, valor: string) => {
        await ctx.post('/orders', ctx.corpoPadrao(), { [header]: valor });
      },
    );
    then(/^a resposta traz o mesmo "(.*)"$/, (header: string) => {
      expect(ctx.resposta?.headers[header]).toBe('11111111-1111-7111-8111-111111111111');
    });
    and(/^o pedido gravado tem "correlation_id" igual a "(.*)"$/, async (valor: string) => {
      expect((await world().orderById(ctx.pedidoId)).correlation_id).toBe(valor);
    });
    and(/^o payload do evento na outbox carrega esse mesmo correlationId$/, async () => {
      const rows = (await world().dataSource.query(
        `SELECT payload->>'$.correlationId' AS correlationId FROM outbox_messages`,
      )) as Array<{ correlationId: string }>;
      expect(rows[0]?.correlationId).toBe('11111111-1111-7111-8111-111111111111');
    });
  });
});
