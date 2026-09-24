import { Contexto } from '../support/steps';
import { CATALOGO_PADRAO, useWorld } from '../support/setup-world';

const world = useWorld();

describe('shutdown gracioso do consumidor', () => {
  let ctx: Contexto;

  beforeEach(async () => {
    ctx = new Contexto(world());
    await ctx.catalogo(
      CATALOGO_PADRAO.map((p) => ({ nome: p.nome, preco: p.preco, estoque: String(p.estoque) })),
    );
    await ctx.autenticar('CUSTOMER');
  });

  it('nenhuma mensagem se perde entre o cancelamento e o fechamento', async () => {
    const pedidos: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      pedidos.push(await ctx.criarPedido(`Cliente ${i}`, [{ produto: 'Teclado', quantidade: '1' }]));
    }
    await world().relay.drainOnce();

    await world().ligarConsumidor();
    // Para no meio do caminho, que é o momento em que o deploy acontece.
    await world().desligarConsumidor();

    const naFila = await world().queueDepth('orders.created');
    const concluidos = await world().countRows('orders', "status <> 'PENDING'");

    // Cada mensagem está concluída ou continua na fila — nunca no limbo.
    expect(naFila + concluidos).toBe(pedidos.length);
  });

  it('parar duas vezes não quebra', async () => {
    await world().ligarConsumidor();
    await world().desligarConsumidor();
    await expect(world().desligarConsumidor()).resolves.toBeUndefined();
  });

  it('o consumidor volta a consumir depois de religado', async () => {
    await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '1' }]);
    await world().relay.drainOnce();
    await world().ligarConsumidor();
    await world().desligarConsumidor();
    await world().ligarConsumidor();
    await ctx.esperarStatus('PROCESSED');
    expect((await world().orderById(ctx.pedidoId)).status).toBe('PROCESSED');
  });
});
