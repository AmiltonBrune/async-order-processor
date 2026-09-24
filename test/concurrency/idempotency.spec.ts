import { ProcessOrderOutcome } from '../../src/application/process-order/process-order.command';
import { largarJuntas } from '../support/barreira';
import { Contexto } from '../support/steps';
import { useWorld } from '../support/setup-world';

const world = useWorld();

describe('duas entregas simultâneas do mesmo evento', () => {
  let ctx: Contexto;

  beforeEach(async () => {
    ctx = new Contexto(world());
    await ctx.catalogo([{ nome: 'Teclado', preco: '10.00', estoque: '5' }]);
    await ctx.autenticar('CUSTOMER');
  });

  it('aplica o decremento exatamente uma vez', async () => {
    const pedido = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '2' }]);
    const eventId = Contexto.novoId();

    const resultados = await largarJuntas([
      () => ctx.processar(pedido, { eventId }),
      () => ctx.processar(pedido, { eventId }),
    ]);

    const concluidos = resultados
      .filter(
        (r): r is PromiseFulfilledResult<ProcessOrderOutcome> => r.status === 'fulfilled',
      )
      .map((r) => r.value);

    expect(concluidos.filter((r) => r === 'PROCESSED')).toHaveLength(1);
    expect(await world().stockOf('Teclado')).toBe(3);
    expect(await world().countRows('stock_reservations', 'order_id = ?', [pedido])).toBe(1);
    expect(await world().sumReservations(pedido)).toBe(2);
    expect((await world().orderById(pedido)).status).toBe('PROCESSED');
  });

  it('eventos diferentes para o mesmo pedido também decrementam uma vez só', async () => {
    const pedido = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '2' }]);

    await largarJuntas([
      () => ctx.processar(pedido, { eventId: Contexto.novoId() }),
      () => ctx.processar(pedido, { eventId: Contexto.novoId() }),
      () => ctx.processar(pedido, { eventId: Contexto.novoId() }),
    ]);

    expect(await world().stockOf('Teclado')).toBe(3);
    expect(await world().countRows('stock_reservations', 'order_id = ?', [pedido])).toBe(1);
  });
});
