import { QueryRunner } from 'typeorm';

import { OrderItem } from '../../src/domain/order/order-item.entity';
import { Order } from '../../src/domain/order/order.entity';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { Money } from '../../src/domain/shared/money.vo';
import { TypeOrmInboxRepository } from '../../src/infrastructure/persistence/inbox/inbox.repository';
import { TypeOrmOrderRepository } from '../../src/infrastructure/persistence/order/order.repository';
import { OutboxDispatchRepository } from '../../src/infrastructure/persistence/outbox/outbox-dispatch.repository';
import { TypeOrmProductRepository } from '../../src/infrastructure/persistence/product/product.repository';
import { TypeOrmStockRepository } from '../../src/infrastructure/persistence/stock/stock.repository';
import { CATALOGO_PADRAO, useWorld } from '../support/setup-world';

const world = useWorld();

const comRunner = async <T>(trabalho: (runner: QueryRunner) => Promise<T>): Promise<T> => {
  const runner = world().dataSource.createQueryRunner();
  await runner.connect();
  try {
    return await trabalho(runner);
  } finally {
    await runner.release();
  }
};

const pedidoDe = (id: string, produtoId: number): Order =>
  Order.restore({
    id,
    customerName: 'Ana Souza',
    status: OrderStatus.PENDING,
    total: Money.of('10.00'),
    items: [new OrderItem(produtoId, 'Teclado', Money.of('10.00'), 1)],
    failureCode: null,
    failureReason: null,
    processingAttempts: 0,
    correlationId: '0193a000-0000-7000-8000-00000000000c',
    processedAt: null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  });

describe('repositórios contra MySQL real', () => {
  beforeEach(async () => {
    await world().seedCatalog(CATALOGO_PADRAO);
  });

  describe('TypeOrmProductRepository', () => {
    it('hidrata o preço como Money, aplicado pelo mapeamento', async () => {
      const [produto] = await comRunner((runner) =>
        new TypeOrmProductRepository(runner).findByNames(['Teclado']),
      );
      expect(produto?.price).toBeInstanceOf(Money);
      expect(produto?.price.toFixed2()).toBe('10.00');
    });

    it('lista de nomes vazia devolve vazio sem quebrar a consulta', async () => {
      await expect(
        comRunner((runner) => new TypeOrmProductRepository(runner).findByNames([])),
      ).resolves.toEqual([]);
    });

    it('o decremento condicional devolve true só quando cabe', async () => {
      const id = await world().productIdOf('Teclado');
      await comRunner(async (runner) => {
        const repo = new TypeOrmProductRepository(runner);
        await expect(repo.decrementStock(id, 4)).resolves.toBe(true);
        await expect(repo.decrementStock(id, 2)).resolves.toBe(false);
        await expect(repo.decrementStock(id, 1)).resolves.toBe(true);
      });
      expect(await world().stockOf('Teclado')).toBe(0);
    });

    it('o UPDATE condicional nunca deixa o estoque negativo', async () => {
      const id = await world().productIdOf('Teclado');
      await comRunner(async (runner) => {
        await expect(new TypeOrmProductRepository(runner).decrementStock(id, 99)).resolves.toBe(false);
      });
      expect(await world().stockOf('Teclado')).toBe(5);
    });
  });

  describe('TypeOrmOrderRepository', () => {
    it('devolve null para id inexistente', async () => {
      await expect(
        comRunner((runner) =>
          new TypeOrmOrderRepository(runner).findById('0193a000-0000-7000-8000-0000000000ff'),
        ),
      ).resolves.toBeNull();
    });

    it('grava e relê o pedido com os itens e o total em Money', async () => {
      const id = '0193a000-0000-7000-8000-00000000001a';
      const produtoId = await world().productIdOf('Teclado');
      const lido = await comRunner(async (runner) => {
        const repo = new TypeOrmOrderRepository(runner);
        await repo.insert(pedidoDe(id, produtoId));
        return repo.findById(id);
      });
      expect(lido?.total.toFixed2()).toBe('10.00');
      expect(lido?.items).toHaveLength(1);
      expect(lido?.items[0]?.unitPrice).toBeInstanceOf(Money);
    });

    it('página além do fim devolve lista vazia com o total preservado', async () => {
      const produtoId = await world().productIdOf('Teclado');
      await comRunner(async (runner) => {
        const repo = new TypeOrmOrderRepository(runner);
        await repo.insert(pedidoDe('0193a000-0000-7000-8000-00000000001b', produtoId));
      });
      const pagina = await comRunner((runner) =>
        new TypeOrmOrderRepository(runner).list({ page: 99, limit: 10 }),
      );
      expect(pagina.data).toEqual([]);
      expect(pagina.total).toBe(1);
    });

    it('a transição condicional recusa quando o estado de origem não bate', async () => {
      const id = '0193a000-0000-7000-8000-00000000001c';
      const produtoId = await world().productIdOf('Teclado');
      await comRunner(async (runner) => {
        const repo = new TypeOrmOrderRepository(runner);
        const pedido = pedidoDe(id, produtoId);
        await repo.insert(pedido);
        pedido.markProcessed(new Date());

        await expect(repo.transitionStatus(pedido, OrderStatus.PENDING)).resolves.toBe(true);
        await expect(repo.transitionStatus(pedido, OrderStatus.PENDING)).resolves.toBe(false);
      });
    });
  });

  describe('idempotência: só chave duplicada vira "já visto"', () => {
    it('reserva duplicada devolve false', async () => {
      const id = '0193a000-0000-7000-8000-00000000002a';
      const produtoId = await world().productIdOf('Teclado');
      await comRunner(async (runner) => {
        await new TypeOrmOrderRepository(runner).insert(pedidoDe(id, produtoId));
        const stock = new TypeOrmStockRepository(runner);
        await expect(stock.reserve(id, produtoId, 1, new Date())).resolves.toBe(true);
        await expect(stock.reserve(id, produtoId, 1, new Date())).resolves.toBe(false);
      });
    });

    it('violação de chave estrangeira SOBE, não vira "já reservado"', async () => {
      const id = '0193a000-0000-7000-8000-00000000002b';
      const produtoId = await world().productIdOf('Teclado');
      await comRunner(async (runner) => {
        await new TypeOrmOrderRepository(runner).insert(pedidoDe(id, produtoId));
        await expect(
          new TypeOrmStockRepository(runner).reserve(id, 999_999, 1, new Date()),
        ).rejects.toThrow();
      });
    });

    it('inbox: erro que NÃO é duplicidade sobe', async () => {
      await comRunner(async (runner) => {
        const inbox = new TypeOrmInboxRepository(runner);
        const consumidorLongoDemais = 'x'.repeat(200);
        await expect(
          inbox.register(consumidorLongoDemais, 'evt-x', '0193a000-0000-7000-8000-00000000002d', new Date()),
        ).rejects.toThrow();
      });
    });

    it('inbox: mesmo (consumidor, evento) devolve false na segunda vez', async () => {
      const id = '0193a000-0000-7000-8000-00000000002c';
      await comRunner(async (runner) => {
        const inbox = new TypeOrmInboxRepository(runner);
        await expect(inbox.register('worker', 'evt-1', id, new Date())).resolves.toBe(true);
        await expect(inbox.register('worker', 'evt-1', id, new Date())).resolves.toBe(false);
        await expect(inbox.register('projecao', 'evt-1', id, new Date())).resolves.toBe(true);
      });
    });
  });

  describe('OutboxDispatchRepository', () => {
    it('lote vazio não reserva nada', async () => {
      const repo = new OutboxDispatchRepository(world().dataSource);
      await expect(repo.claimBatch(10, new Date())).resolves.toEqual([]);
    });

    it('marcar publicado sem ids é inofensivo', async () => {
      const repo = new OutboxDispatchRepository(world().dataSource);
      await expect(repo.markPublished([], new Date())).resolves.toBeUndefined();
    });

    it('o payload volta como objeto, independentemente do caminho do driver', async () => {
      await world().dataSource.query(
        `INSERT INTO outbox_messages
           (event_id, aggregate_type, aggregate_id, event_name, payload, status, available_at, created_at)
         VALUES (?, 'Order', ?, 'order.created', CAST(? AS JSON), 'PENDING', NOW(3), NOW(3))`,
        [
          '0193a000-0000-7000-8000-00000000003a',
          '0193a000-0000-7000-8000-00000000003b',
          JSON.stringify({ orderId: 'o1', correlationId: 'c1' }),
        ],
      );
      const [mensagem] = await new OutboxDispatchRepository(world().dataSource).claimBatch(
        10,
        new Date(),
      );
      expect(mensagem?.payload).toEqual({ orderId: 'o1', correlationId: 'c1' });
      expect(typeof mensagem?.id).toBe('number');
    });

    it('falha durante a reserva desfaz a transação e propaga o erro', async () => {
      const repo = new OutboxDispatchRepository(world().dataSource);
      const original = world().dataSource.createQueryRunner.bind(world().dataSource);
      const espiao = jest.spyOn(world().dataSource, 'createQueryRunner').mockImplementation(() => {
        const runner = original();
        const manager = runner.manager;
        jest.spyOn(manager, 'createQueryBuilder').mockImplementation(() => {
          throw new Error('MySQL caiu no meio da reserva');
        });
        return runner;
      });

      await expect(repo.claimBatch(10, new Date())).rejects.toThrow('MySQL caiu no meio da reserva');

      espiao.mockRestore();
      await expect(repo.claimBatch(1, new Date())).resolves.toBeDefined();
    });

    it('o mapeamento entrega o payload como objeto, mesmo gravado como texto', async () => {
      await world().dataSource.query(
        `INSERT INTO outbox_messages
           (event_id, aggregate_type, aggregate_id, event_name, payload, status, available_at, created_at)
         VALUES (?, 'Order', ?, 'order.created', ?, 'PENDING', NOW(3), NOW(3))`,
        [
          '0193a000-0000-7000-8000-00000000004a',
          '0193a000-0000-7000-8000-00000000004b',
          JSON.stringify({ orderId: 'o2' }),
        ],
      );
      const [mensagem] = await new OutboxDispatchRepository(world().dataSource).claimBatch(
        10,
        new Date(),
      );
      expect(mensagem?.payload).toEqual({ orderId: 'o2' });
    });

    it('depois de uma falha, a conexão volta para o pool', async () => {
      const repo = new OutboxDispatchRepository(world().dataSource);
      for (let i = 0; i < 40; i += 1) {
        await repo.claimBatch(1, new Date());
      }
      await expect(repo.claimBatch(1, new Date())).resolves.toBeDefined();
    });
  });
});
