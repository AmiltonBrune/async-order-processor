import { largarJuntas } from '../support/barreira';
import { Contexto } from '../support/steps';
import { useWorld } from '../support/setup-world';

const world = useWorld();

describe('pedidos com os mesmos produtos em ordem oposta', () => {
  let ctx: Contexto;

  beforeEach(async () => {
    ctx = new Contexto(world());
    await ctx.catalogo([
      { nome: 'Teclado', preco: '10.00', estoque: '200' },
      { nome: 'Mouse', preco: '3.33', estoque: '200' },
    ]);
    await ctx.autenticar('CUSTOMER');
  });

  it('nenhum pedido fica preso em PENDING ao longo de 50 rodadas', async () => {
    const RODADAS = 50;
    const erros: string[] = [];

    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      const a = await ctx.criarPedido(`A-${rodada}`, [
        { produto: 'Teclado', quantidade: '1' },
        { produto: 'Mouse', quantidade: '1' },
      ]);
      const b = await ctx.criarPedido(`B-${rodada}`, [
        { produto: 'Mouse', quantidade: '1' },
        { produto: 'Teclado', quantidade: '1' },
      ]);

      const resultados = await largarJuntas([
        () => ctx.processar(a, { eventId: Contexto.novoId() }),
        () => ctx.processar(b, { eventId: Contexto.novoId() }),
      ]);
      for (const resultado of resultados) {
        if (resultado.status === 'rejected') erros.push(String(resultado.reason));
      }
    }

    // A ordenação por product_id elimina o ciclo de espera. Se algum deadlock
    // escapasse, ele seria classificado como transitório e retentado pelo
    // consumidor — mas aqui o caso de uso é chamado direto, então qualquer
    // deadlock aparece como rejeição, e é isso que este teste vigia.
    expect(erros.filter((erro) => erro.includes('Deadlock'))).toEqual([]);
    expect(await world().countRows('orders', "status = 'PENDING'")).toBe(0);
    expect(await world().countRows('orders', "status = 'PROCESSED'")).toBe(RODADAS * 2);

    // Cada pedido consumiu uma unidade de cada produto, sem sobra nem falta.
    expect(await world().stockOf('Teclado')).toBe(200 - RODADAS * 2);
    expect(await world().stockOf('Mouse')).toBe(200 - RODADAS * 2);
    expect(await world().countRows('stock_reservations')).toBe(RODADAS * 4);
  });
});
