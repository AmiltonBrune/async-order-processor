import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { largarJuntas } from '../support/barreira';
import { Contexto } from '../support/steps';
import { useWorld } from '../support/setup-world';

const world = useWorld();

describe('dez pedidos simultâneos para um estoque de cinco', () => {
  let ctx: Contexto;

  beforeEach(async () => {
    ctx = new Contexto(world());
    await ctx.catalogo([{ nome: 'Teclado', preco: '10.00', estoque: '5' }]);
    await ctx.autenticar('CUSTOMER');
  });

  it('nunca vende mais do que existe, e distribui exatamente o estoque disponível', async () => {
    const pedidos: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      pedidos.push(await ctx.criarPedido(`Cliente ${i}`, [{ produto: 'Teclado', quantidade: '1' }]));
    }

    const resultados = await largarJuntas(
      pedidos.map((id) => () => ctx.processar(id, { eventId: Contexto.novoId() })),
    );

    const falhasInesperadas = resultados.filter((r) => r.status === 'rejected');
    expect(falhasInesperadas).toEqual([]);

    // 1. O estoque acabou exatamente, e nunca ficou negativo — o CHECK do MySQL
    //    teria abortado a transação, e isso apareceria como rejeição acima.
    expect(await world().stockOf('Teclado')).toBe(0);

    // 2. Exatamente cinco couberam.
    expect(await world().countRows('orders', 'status = ?', [OrderStatus.PROCESSED])).toBe(5);

    // 3. Exatamente cinco não couberam, com o motivo do enunciado.
    expect(
      await world().countRows('orders', 'status = ? AND failure_code = ?', [
        OrderStatus.FAILED,
        'INSUFFICIENT_STOCK',
      ]),
    ).toBe(5);
    expect(
      await world().countRows('orders', "failure_reason = 'estoque insuficiente'"),
    ).toBe(5);

    // 4. A soma reservada bate com o estoque consumido.
    expect(await world().sumReservations()).toBe(5);

    // 5. A assertiva que pega o bug sutil: nenhuma reserva órfã. Um código que
    //    decremente e só depois falhe em outro item deixaria estoque "sumido"
    //    sem pedido correspondente — e as quatro primeiras asserções passariam.
    expect(await world().countRows('stock_reservations')).toBe(5);

    // 6. Nenhum pedido ficou preso: todos concluíram de um jeito ou de outro.
    expect(await world().countRows('orders', 'status = ?', [OrderStatus.PENDING])).toBe(0);
  });

  it('com quantidades desiguais, o estoque consumido bate com os pedidos confirmados', async () => {
    // 3 + 3 + 2 = 8 para um estoque de 5: nenhuma combinação cabe inteira, e a
    // que couber depende de quem chegar primeiro no UPDATE — o que é correto.
    const quantidades = ['3', '3', '2'];
    const pedidos: string[] = [];
    for (const quantidade of quantidades) {
      pedidos.push(await ctx.criarPedido(`Cliente ${quantidade}`, [{ produto: 'Teclado', quantidade }]));
    }

    await largarJuntas(pedidos.map((id) => () => ctx.processar(id, { eventId: Contexto.novoId() })));

    const estoqueFinal = await world().stockOf('Teclado');
    expect(estoqueFinal).toBeGreaterThanOrEqual(0);

    const confirmados = (await world().dataSource.query(
      `SELECT COALESCE(SUM(oi.quantity), 0) AS total
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status = 'PROCESSED'`,
    )) as Array<{ total: number | string }>;
    const somaConfirmada = Number(confirmados[0]?.total ?? 0);

    expect(somaConfirmada).toBeLessThanOrEqual(5);
    expect(5 - somaConfirmada).toBe(estoqueFinal);
    expect(await world().sumReservations()).toBe(somaConfirmada);
    expect(
      await world().countRows('orders', "status = 'FAILED' AND failure_code <> 'INSUFFICIENT_STOCK'"),
    ).toBe(0);
    expect(await world().countRows('orders', "status = 'PENDING'")).toBe(0);
  });
});
