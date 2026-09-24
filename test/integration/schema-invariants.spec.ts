import { useWorld } from '../support/setup-world';

const world = useWorld();

const criarTabela = async (tabela: string): Promise<string> => {
  const rows = (await world().dataSource.query(`SHOW CREATE TABLE ${tabela}`)) as Array<
    Record<string, string>
  >;
  return Object.values(rows[0] ?? {}).join('\n');
};

describe('schema criado pela migration', () => {
  it('products impede estoque negativo no proprio banco', async () => {
    const ddl = await criarTabela('products');
    expect(ddl).toContain('ck_products_stock_non_negative');
    expect(ddl).toMatch(/`stock` int unsigned/i);
  });

  it('o CHECK de estoque recusa a escrita, nao so a aplicacao', async () => {
    // A rede de seguranca abaixo da logica: se um caminho de codigo futuro
    // decrementar sem a clausula condicional, o MySQL recusa.
    await world().seedCatalog([{ nome: 'Teclado', preco: '10.00', estoque: 1 }]);
    await expect(
      world().dataSource.query(`UPDATE products SET stock = stock - 5 WHERE name = 'Teclado'`),
    ).rejects.toThrow();
    expect(await world().stockOf('Teclado')).toBe(1);
  });

  it('stock_reservations tem a chave unica que garante a idempotencia do efeito', async () => {
    const ddl = await criarTabela('stock_reservations');
    expect(ddl).toContain('uq_stock_reservations_order_product');
  });

  it('inbox_messages e chaveada por consumidor e evento', async () => {
    expect(await criarTabela('inbox_messages')).toMatch(/PRIMARY KEY \(`consumer`,`event_id`\)/);
  });

  it('orders nao aceita FAILED sem motivo', async () => {
    expect(await criarTabela('orders')).toContain('ck_orders_failure_pair');
  });

  it('order_items calcula line_total no banco, como coluna gerada', async () => {
    // Calcular em dois lugares e como o total do pedido diverge da soma das
    // linhas: a coluna gerada torna a divergencia impossivel.
    const ddl = await criarTabela('order_items');
    expect(ddl).toMatch(/`line_total` decimal\(12,2\) GENERATED ALWAYS AS/i);
    expect(ddl).toContain('STORED');
  });

  it('os indices que servem as consultas do sistema existem', async () => {
    const orders = await criarTabela('orders');
    expect(orders).toContain('ix_orders_created_at');
    expect(orders).toContain('ix_orders_status_created_at');
    expect(orders).toContain('ix_orders_correlation_id');
    expect(await criarTabela('outbox_messages')).toContain('ix_outbox_dispatch');
  });

  it('dinheiro e DECIMAL(12,2), nunca float', async () => {
    const orders = await criarTabela('orders');
    expect(orders).toMatch(/`total_amount` decimal\(12,2\)/i);
    expect(orders).not.toMatch(/float|double/i);
  });

  it('o id do pedido e CHAR(36), exposto na URL sem vazar volume de negocio', async () => {
    expect(await criarTabela('orders')).toMatch(/`id` char\(36\)/i);
  });
});
