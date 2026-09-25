import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { Contexto } from '../support/steps';
import { CATALOGO_PADRAO, useWorld } from '../support/setup-world';

const feature = loadFeature('features/consulta-de-pedidos.feature');
const world = useWorld();

interface CorpoLista {
  data: Array<Record<string, unknown>>;
  meta: { page: number; limit: number; total: number; totalPages: number };
}

defineFeature(feature, (test) => {
  let ctx: Contexto;

  const autenticado = (given: DefineStepFunction): void => {
    given(/^que estou autenticado com o papel "(.*)"$/, async (papel: string) => {
      ctx = new Contexto(world());
      await ctx.catalogo(
        CATALOGO_PADRAO.map((p) => ({ nome: p.nome, preco: p.preco, estoque: String(p.estoque) })),
      );
      await ctx.autenticar(papel);
    });
  };

  const pedidoNoStatus = async (status: string): Promise<string> => {
    const id = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '1' }]);
    if (status === 'PROCESSED') await ctx.processar(id);
    if (status === 'FAILED') {
      await world().dataSource.query(`UPDATE products SET stock = 0 WHERE name = 'Teclado'`);
      await ctx.processar(id);
      await world().dataSource.query(`UPDATE products SET stock = 5 WHERE name = 'Teclado'`);
    }
    return id;
  };

  test('Consulta por id devolve o status atual', ({ given, and, when, then }) => {
    autenticado(given);

    and(/^um pedido de "(.*)" no status "(.*)"$/, async (_cliente: string, status: string) => {
      await pedidoNoStatus(status);
    });
    when(/^eu envio "GET \/orders\/\{id\}" para esse pedido$/, async () => {
      await ctx.get(`/orders/${ctx.pedidoId}`);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "(.*)" da resposta é "(.*)"$/, (campo: string, valor: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toBe(valor);
    });
    and(/^a resposta traz "(.*)", "(.*)", "(.*)" e "(.*)"$/, (...campos: string[]) => {
      const corpo = ctx.resposta?.body as Record<string, unknown>;
      for (const campo of campos.slice(0, 4)) expect(corpo[campo]).toBeDefined();
    });
  });

  test('Pedido FAILED mostra o motivo', ({ given, and, when, then }) => {
    autenticado(given);

    and(
      /^um pedido de "(.*)" no status "(.*)" com código "(.*)" e motivo "(.*)"$/,
      async (_cliente: string, status: string) => {
        await pedidoNoStatus(status);
      },
    );
    when(/^eu envio "GET \/orders\/\{id\}" para esse pedido$/, async () => {
      await ctx.get(`/orders/${ctx.pedidoId}`);
    });
    then(/^o campo "(.*)" da resposta é "(.*)"$/, (campo: string, valor: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toBe(valor);
    });
    and(/^o campo "(.*)" da resposta é "(.*)"$/, (campo: string, valor: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toBe(valor);
    });
  });

  test('Id inexistente ou malformado', ({ given, when, then, and }) => {
    autenticado(given);

    when(/^eu envio "GET \/orders\/(.*)"$/, async (id: string) => {
      await ctx.get(`/orders/${id}`);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      // Malformado é 400 e inexistente é 404: erro do cliente e recurso ausente
      // não são a mesma coisa, e confundi-los esconde bug de integração.
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
  });

  const criarLote = async (quantidade: number): Promise<void> => {
    for (let i = 0; i < quantidade; i += 1) {
      await ctx.criarPedido(`Cliente ${i}`, [{ produto: 'Teclado', quantidade: '1' }]);
    }
  };

  test('Listagem pagina e traz os metadados', ({ given, and, when, then }) => {
    autenticado(given);

    and(/^(\d+) pedidos criados em ordem$/, async (quantidade: string) => {
      await criarLote(Number(quantidade));
    });
    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^a lista tem (\d+) itens$/, (itens: string) => {
      expect((ctx.resposta?.body as CorpoLista).data).toHaveLength(Number(itens));
    });
    and(
      /^"meta" é: page (\d+), limit (\d+), total (\d+), totalPages (\d+)$/,
      (page: string, limit: string, total: string, totalPages: string) => {
        expect((ctx.resposta?.body as CorpoLista).meta).toEqual({
          page: Number(page),
          limit: Number(limit),
          total: Number(total),
          totalPages: Number(totalPages),
        });
      },
    );
    and(/^os pedidos vêm do mais recente para o mais antigo$/, () => {
      const datas = (ctx.resposta?.body as CorpoLista).data.map((p) => String(p['createdAt']));
      expect([...datas].sort().reverse()).toEqual(datas);
    });
  });

  test('Bordas da paginação', ({ given, and, when, then }) => {
    autenticado(given);

    and(/^(\d+) pedidos criados em ordem$/, async (quantidade: string) => {
      await criarLote(Number(quantidade));
    });
    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^a lista tem (\d+) itens$/, (itens: string) => {
      const corpo = ctx.resposta?.body as CorpoLista;
      expect(corpo.data === undefined ? 0 : corpo.data.length).toBe(Number(itens));
    });
  });

  test('Filtro por status', ({ given, and, when, then }) => {
    autenticado(given);

    and(
      /^(\d+) pedidos "(.*)" e (\d+) pedidos "(.*)"$/,
      async (qtdA: string, statusA: string, qtdB: string, statusB: string) => {
        for (let i = 0; i < Number(qtdA); i += 1) await pedidoNoStatus(statusA);
        for (let i = 0; i < Number(qtdB); i += 1) await pedidoNoStatus(statusB);
      },
    );
    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a lista tem (\d+) itens$/, (itens: string) => {
      expect((ctx.resposta?.body as CorpoLista).data).toHaveLength(Number(itens));
    });
    and(/^todos os itens da lista têm status "(.*)"$/, (status: string) => {
      const corpo = ctx.resposta?.body as CorpoLista;
      expect(corpo.data.every((pedido) => pedido['status'] === status)).toBe(true);
    });
    and(/^"meta.total" é (\d+)$/, (total: string) => {
      expect((ctx.resposta?.body as CorpoLista).meta.total).toBe(Number(total));
    });
  });

  test('Status inválido no filtro', ({ given, when, then, and }) => {
    autenticado(given);

    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
  });

  test('Sem parâmetros, usa o padrão', ({ given, and, when, then }) => {
    autenticado(given);

    and(/^(\d+) pedidos criados em ordem$/, async (quantidade: string) => {
      await criarLote(Number(quantidade));
    });
    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(
      /^"meta" é: page (\d+), limit (\d+), total (\d+), totalPages (\d+)$/,
      (page: string, limit: string, total: string, totalPages: string) => {
        expect((ctx.resposta?.body as CorpoLista).meta).toEqual({
          page: Number(page),
          limit: Number(limit),
          total: Number(total),
          totalPages: Number(totalPages),
        });
      },
    );
  });

  // Isolamento por dono. O "operador" é a outra identidade semeada pela
  // migration — o que importa é que o subject do token difere.
  const criarComoOperador = async (quantidade: number): Promise<string> => {
    await ctx.autenticar('ADMIN');
    let ultimo = '';
    for (let i = 0; i < quantidade; i += 1) {
      ultimo = await ctx.criarPedido(`Operador ${i}`, [{ produto: 'Teclado', quantidade: '1' }]);
    }
    await ctx.autenticar('CUSTOMER');
    return ultimo;
  };

  test('Cliente não enxerga pedido criado por outra identidade', ({ given, when, then, and }) => {
    autenticado(given);

    let doOperador = '';
    given(/^um pedido criado pelo operador$/, async () => {
      doOperador = await criarComoOperador(1);
    });
    when(/^eu envio "GET \/orders\/\{id\}" para esse pedido$/, async () => {
      await ctx.get(`/orders/${doOperador}`);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
  });

  test('A listagem mostra só os pedidos de quem pediu', ({ given, and, when, then }) => {
    autenticado(given);

    and(/^(\d+) pedidos meus e (\d+) criados pelo operador$/, async (meus: string, deles: string) => {
      await criarComoOperador(Number(deles));
      await criarLote(Number(meus));
    });
    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a lista tem (\d+) itens$/, (quantidade: string) => {
      expect((ctx.resposta?.body as CorpoLista).data).toHaveLength(Number(quantidade));
    });
    and(/^"meta.total" é (\d+)$/, (total: string) => {
      expect((ctx.resposta?.body as CorpoLista).meta.total).toBe(Number(total));
    });
  });

  test('O operador ADMIN enxerga os pedidos de todos', ({ given, and, when, then }) => {
    autenticado(given);

    and(/^(\d+) pedidos meus e (\d+) criados pelo operador$/, async (meus: string, deles: string) => {
      await criarComoOperador(Number(deles));
      await criarLote(Number(meus));
    });
    and(/^que me autentico como "(.*)"$/, async (papel: string) => {
      await ctx.autenticar(papel);
    });
    when(/^eu envio "GET (.*)"$/, async (rota: string) => {
      await ctx.get(rota);
    });
    then(/^a lista tem (\d+) itens$/, (quantidade: string) => {
      expect((ctx.resposta?.body as CorpoLista).data).toHaveLength(Number(quantidade));
    });
    and(/^"meta.total" é (\d+)$/, (total: string) => {
      expect((ctx.resposta?.body as CorpoLista).meta.total).toBe(Number(total));
    });
  });
});
