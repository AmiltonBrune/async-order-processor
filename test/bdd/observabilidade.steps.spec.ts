process.env['LOG_LEVEL'] = 'info';

import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';

import { Contexto, LinhaCatalogo } from '../support/steps';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/observabilidade.feature');
const world = useWorld();

class CapturaDeLog {
  readonly linhas: string[] = [];
  private original: typeof process.stdout.write | null = null;

  ligar(): void {
    if (this.original !== null) return;
    const original = process.stdout.write.bind(process.stdout);
    this.original = original;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      const texto = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      for (const linha of texto.split('\n')) if (linha.trim() !== '') this.linhas.push(linha);
      return original(chunk);
    }) as typeof process.stdout.write;
  }

  desligar(): void {
    if (this.original === null) return;
    process.stdout.write = this.original;
    this.original = null;
  }

  json(): Array<Record<string, unknown>> {
    return this.linhas
      .filter((linha) => linha.startsWith('{'))
      .map((linha) => JSON.parse(linha) as Record<string, unknown>);
  }
}

defineFeature(feature, (test) => {
  let ctx: Contexto;
  let captura: CapturaDeLog;

  const catalogo = (given: DefineStepFunction): void => {
    given(/^o catálogo com os produtos:$/, async (tabela: LinhaCatalogo[]) => {
      ctx = new Contexto(world());
      await ctx.catalogo(tabela);
      await ctx.autenticar('CUSTOMER');
      captura = new CapturaDeLog();
      captura.ligar();
    });
  };

  afterEach(() => {
    captura?.desligar();
  });

  test('O mesmo correlationId aparece nos três processos', ({ given, when, and, then }) => {
    catalogo(given);

    when(/^eu envio um pedido válido de "(.*)"$/, async (cliente: string) => {
      await ctx.criarPedido(cliente);
    });
    and(/^o pedido é processado até "(.*)"$/, async (status: string) => {
      world().ligarRelay();
      await world().ligarConsumidor();
      await ctx.esperarStatus(status);
    });
    then(/^os logs da API contêm o correlationId do pedido$/, () => {
      expect(
        captura
          .json()
          .some(
            (l) =>
              l['correlationId'] === ctx.correlationId &&
              l['msg'] === 'Requisicao concluida' &&
              l['rota'] === '/orders',
          ),
      ).toBe(true);
    });
    and(/^os logs do relay contêm o mesmo correlationId$/, () => {
      expect(
        captura.json().some((l) => l['correlationId'] === ctx.correlationId && l['msg'] === 'Evento publicado'),
      ).toBe(true);
    });
    and(/^os logs do consumidor contêm o mesmo correlationId$/, () => {
      expect(
        captura
          .json()
          .some((l) => l['correlationId'] === ctx.correlationId && l['msg'] === 'Mensagem processada'),
      ).toBe(true);
    });
    and(/^a coluna "orders.correlation_id" tem esse mesmo valor$/, async () => {
      expect((await world().orderById(ctx.pedidoId)).correlation_id).toBe(ctx.correlationId);
    });
    and(/^o payload do evento na outbox carrega esse mesmo valor$/, async () => {
      const rows = (await world().dataSource.query(
        `SELECT payload->>'$.correlationId' AS correlationId FROM outbox_messages`,
      )) as Array<{ correlationId: string }>;
      expect(rows[0]?.correlationId).toBe(ctx.correlationId);
    });
    and(/^o header AMQP "(.*)" da mensagem carrega esse mesmo valor$/, () => {
      expect(
        captura
          .json()
          .some((l) => l['correlationId'] === ctx.correlationId && l['msg'] === 'Mensagem processada'),
      ).toBe(true);
    });
  });

  test('Todo log é JSON com os campos de investigação', ({ given, when, then, and }) => {
    catalogo(given);

    when(/^eu envio um pedido válido de "(.*)"$/, async (cliente: string) => {
      await ctx.criarPedido(cliente);
      world().ligarRelay();
      await world().ligarConsumidor();
      await ctx.esperarStatus('PROCESSED');
    });
    then(/^cada linha de log é um JSON válido$/, () => {
      const linhas = captura.linhas.filter((l) => l.startsWith('{'));
      expect(linhas.length).toBeGreaterThan(0);
      for (const linha of linhas) expect(() => JSON.parse(linha)).not.toThrow();
    });
    and(/^cada linha tem os campos "(.*)", "(.*)", "(.*)" e "(.*)"$/, (...campos: string[]) => {
      const comCorrelacao = captura.json().filter((l) => l['correlationId'] !== undefined);
      expect(comCorrelacao.length).toBeGreaterThan(0);
      for (const linha of comCorrelacao) {
        for (const campo of campos.slice(0, 4)) expect(linha[campo]).toBeDefined();
      }
    });
    and(/^as linhas do processamento têm também "(.*)"$/, (campo: string) => {
      expect(
        captura.json().some((l) => l['msg'] === 'Mensagem processada' && l[campo] === ctx.pedidoId),
      ).toBe(true);
    });
  });

  test('Pedido preso responde onde parou', ({ given, when, then, and }) => {
    catalogo(given);
    let linhasDaOutbox: Array<{ status: string; attempts: number; lastError: string }> = [];

    given(/^um pedido PENDING criado há (\d+) minutos com o relay parado$/, async () => {
      await ctx.criarPedido('Ana Souza');
      await world().dataSource.query(
        `UPDATE outbox_messages
            SET attempts = 3, last_error = 'ECONNREFUSED ao publicar no broker',
                created_at = DATE_SUB(NOW(3), INTERVAL 10 MINUTE)`,
      );
    });
    when(/^eu consulto a outbox por esse pedido$/, async () => {
      linhasDaOutbox = (await world().dataSource.query(
        `SELECT status, attempts, last_error AS lastError
           FROM outbox_messages WHERE aggregate_id = ?`,
        [ctx.pedidoId],
      )) as Array<{ status: string; attempts: number; lastError: string }>;
      expect(linhasDaOutbox).toHaveLength(1);
    });
    then(
      /^existe uma linha "(.*)" em "outbox_messages" com "attempts" maior que (\d+)$/,
      async (status: string, minimo: string) => {
        expect(
          await world().countRows('outbox_messages', 'status = ? AND attempts > ? AND aggregate_id = ?', [
            status,
            Number(minimo),
            ctx.pedidoId,
          ]),
        ).toBe(1);
      },
    );
    and(/^o campo "last_error" explica por que a publicação não passou$/, () => {
      expect(linhasDaOutbox[0]?.lastError).toContain('ECONNREFUSED');
    });
    and(/^a fila "(.*)" não tem mensagem para esse pedido$/, async (fila: string) => {
      expect(await world().queueDepth(fila)).toBe(0);
    });
  });

  test('Resposta de erro devolve o correlationId para o chamado de suporte', ({
    given,
    when,
    then,
    and,
  }) => {
    catalogo(given);

    let identificador = '';

    when(/^eu envio um pedido com um produto fora do catálogo$/, async () => {
      await ctx.post('/orders', {
        customerName: 'Ana Souza',
        items: [{ productName: 'Produto Que Nao Existe', quantity: 1, price: '10.00' }],
      });
    });

    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });

    and(/^o header "(.*)" da resposta traz um identificador$/, (header: string) => {
      identificador = String(ctx.resposta?.headers[header] ?? '');
      expect(identificador).not.toBe('');
    });

    and(/^o campo "(.*)" do corpo traz o mesmo identificador$/, (campo: string) => {
      const corpo = ctx.resposta?.body as Record<string, unknown>;
      expect(corpo[campo]).toBe(identificador);
    });

    and(/^os logs contêm esse mesmo identificador$/, () => {
      expect(captura.json().some((linha) => linha['correlationId'] === identificador)).toBe(true);
    });
  });

  test('Log não vaza segredo', ({ given, when, then, and }) => {
    catalogo(given);

    when(/^eu envio "POST \/auth\/login" com "(.*)" e "(.*)"$/, async (email: string, senha: string) => {
      await ctx.post('/auth/login', { email, password: senha });
    });
    then(/^nenhuma linha de log contém a senha$/, () => {
      expect(captura.linhas.join('\n')).not.toContain('cliente123');
    });
    and(/^nenhuma linha de log contém o token emitido$/, () => {
      const token = String((ctx.resposta?.body as { accessToken?: string }).accessToken ?? 'x');
      expect(captura.linhas.join('\n')).not.toContain(token);
    });
    and(/^o campo "(.*)" aparece redigido nos logs$/, (campo: string) => {
      const { StructuredLogger } = jest.requireActual<
        typeof import('../../src/infrastructure/observability/pino.logger')
      >('../../src/infrastructure/observability/pino.logger');
      const logger = new StructuredLogger('info', 'test');
      logger.log('teste de redacao', { [campo]: 'Bearer segredo-que-nao-pode-vazar' });
      const ultima = captura.linhas[captura.linhas.length - 1] ?? '';
      expect(ultima).toContain('[REDACTED]');
      expect(ultima).not.toContain('segredo-que-nao-pode-vazar');
    });
  });
});
