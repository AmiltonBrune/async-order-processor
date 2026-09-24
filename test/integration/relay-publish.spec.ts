import { Contexto } from '../support/steps';
import { CATALOGO_PADRAO, useWorld } from '../support/setup-world';

const world = useWorld();

describe('relay drenando a outbox', () => {
  let ctx: Contexto;

  beforeEach(async () => {
    ctx = new Contexto(world());
    await ctx.catalogo(
      CATALOGO_PADRAO.map((p) => ({ nome: p.nome, preco: p.preco, estoque: String(p.estoque) })),
    );
    await ctx.autenticar('CUSTOMER');
    await world().desligarConsumidor();
  });

  it('publica o evento e só então marca PUBLISHED', async () => {
    await ctx.criarPedido('Ana Souza');
    expect(await world().countRows('outbox_messages', "status = 'PENDING'")).toBe(1);

    const publicadas = await world().relay.drainOnce();

    expect(publicadas).toBe(1);
    expect(await world().countRows('outbox_messages', "status = 'PUBLISHED'")).toBe(1);
    expect(await world().queueDepth('orders.created')).toBe(1);

    const rows = (await world().dataSource.query(
      `SELECT published_at AS publishedAt FROM outbox_messages`,
    )) as Array<{ publishedAt: Date | null }>;
    expect(rows[0]?.publishedAt).not.toBeNull();
  });

  it('falha na publicação não perde a mensagem nem marca PUBLISHED', async () => {
    await ctx.criarPedido('Ana Souza');
    jest.spyOn(world().publisher, 'publishCreated').mockRejectedValueOnce(
      new Error('ECONNREFUSED ao publicar no broker'),
    );

    const publicadas = await world().relay.drainOnce();

    expect(publicadas).toBe(0);
    const rows = (await world().dataSource.query(
      `SELECT status, attempts, last_error AS lastError FROM outbox_messages`,
    )) as Array<{ status: string; attempts: number; lastError: string }>;
    expect(rows[0]?.status).toBe('PENDING');
    expect(Number(rows[0]?.attempts)).toBe(1);
    expect(rows[0]?.lastError).toContain('ECONNREFUSED');
    jest.restoreAllMocks();
  });

  it('um ciclo sem trabalho não publica nada e não quebra', async () => {
    expect(await world().relay.drainOnce()).toBe(0);
  });

  it('publica um lote inteiro num ciclo só', async () => {
    for (let i = 0; i < 5; i += 1) await ctx.criarPedido(`Cliente ${i}`);
    expect(await world().relay.drainOnce()).toBe(5);
    expect(await world().countRows('outbox_messages', "status = 'PUBLISHED'")).toBe(5);
  });
});
