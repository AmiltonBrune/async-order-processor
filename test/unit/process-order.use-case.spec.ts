import { ProcessOrderUseCase } from '../../src/application/process-order/process-order.use-case';
import { ProcessOrderCommand } from '../../src/application/process-order/process-order.command';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { TransientError } from '../../src/domain/shared/errors';
import { FixedClock, InMemoryDatabase, InMemoryUnitOfWork } from '../support/in-memory';

const COMANDO: ProcessOrderCommand = {
  eventId: 'evt-1',
  orderId: 'order-1',
  correlationId: 'corr-1',
  consumer: 'order-processor',
  attempt: 1,
};

const montar = (estoque = 5) => {
  const db = InMemoryDatabase.withCatalog(['Teclado', estoque], ['Mouse', estoque]);
  const unitOfWork = new InMemoryUnitOfWork(db);
  const useCase = new ProcessOrderUseCase(unitOfWork, new FixedClock(), 0);
  return { db, unitOfWork, useCase };
};

describe('ProcessOrderUseCase', () => {
  it('reserva o estoque e conclui o pedido', async () => {
    const { db, useCase } = montar();
    db.seedOrder({ id: 'order-1' });

    await expect(useCase.execute(COMANDO)).resolves.toBe('PROCESSED');

    expect(db.orderById('order-1').status).toBe(OrderStatus.PROCESSED);
    expect(db.orderById('order-1').processedAt).not.toBeNull();
    expect(db.stockOf('Teclado')).toBe(3);
    expect(db.reservations).toEqual([{ orderId: 'order-1', productId: 1, quantity: 2 }]);
  });

  it('reprova por estoque insuficiente sem tocar no catalogo', async () => {
    const { db, useCase } = montar(1);
    db.seedOrder({ id: 'order-1' });

    await expect(useCase.execute(COMANDO)).resolves.toBe('FAILED');

    const pedido = db.orderById('order-1');
    expect(pedido.status).toBe(OrderStatus.FAILED);
    expect(pedido.failureCode).toBe('INSUFFICIENT_STOCK');
    expect(pedido.failureReason).toBe('estoque insuficiente');
    expect(db.stockOf('Teclado')).toBe(1);
    expect(db.reservations).toHaveLength(0);
  });

  it('pedido multi-item e tudo ou nada', async () => {
    const { db, useCase } = montar(5);
    db.seedOrder({
      id: 'order-1',
      items: [
        { productId: 1, productName: 'Teclado', unitPrice: '10.00', quantity: 2 },
        { productId: 2, productName: 'Mouse', unitPrice: '3.33', quantity: 9 },
      ],
    });

    await expect(useCase.execute(COMANDO)).resolves.toBe('FAILED');

    expect(db.stockOf('Teclado')).toBe(5);
    expect(db.stockOf('Mouse')).toBe(5);
    expect(db.reservations).toHaveLength(0);
  });

  it('processa os itens em ordem crescente de product_id', async () => {
    const { db, useCase } = montar();
    db.seedOrder({
      id: 'order-1',
      items: [
        { productId: 2, productName: 'Mouse', unitPrice: '3.33', quantity: 1 },
        { productId: 1, productName: 'Teclado', unitPrice: '10.00', quantity: 1 },
      ],
    });

    await useCase.execute(COMANDO);

    expect(db.reservations.map((reserva) => reserva.productId)).toEqual([1, 2]);
  });

  describe('idempotencia', () => {
    it('camada 1: reentrega do mesmo event_id nao refaz o efeito', async () => {
      const { db, useCase } = montar();
      db.seedOrder({ id: 'order-1' });

      await useCase.execute(COMANDO);
      await expect(useCase.execute(COMANDO)).resolves.toBe('DUPLICATE');

      expect(db.stockOf('Teclado')).toBe(3);
      expect(db.reservations).toHaveLength(1);
    });

    it('camada 2: pedido que ja saiu de PENDING nao e reprocessado', async () => {
      const { db, useCase } = montar();
      db.seedOrder({ id: 'order-1', status: OrderStatus.PROCESSED });

      await expect(useCase.execute({ ...COMANDO, eventId: 'evt-outro' })).resolves.toBe('DUPLICATE');

      expect(db.stockOf('Teclado')).toBe(5);
    });

    it('camada 3: evento novo sobre pedido que ja reservou reverte tudo', async () => {
      const { db, useCase } = montar();
      db.seedOrder({ id: 'order-1' });
      await useCase.execute(COMANDO);
      db.orderById('order-1').status = OrderStatus.PENDING;

      await expect(useCase.execute({ ...COMANDO, eventId: 'evt-2' })).resolves.toBe('DUPLICATE');

      expect(db.stockOf('Teclado')).toBe(3);
      expect(db.reservations).toHaveLength(1);
    });
  });

  it('evento de pedido inexistente vai para a dead-letter, nao para a retentativa', async () => {
    const { useCase } = montar();
    await expect(useCase.execute(COMANDO)).resolves.toBe('DEAD_LETTER');
  });

  it('o gatilho "fail" do enunciado e erro TRANSITORIO, nao de negocio', async () => {
    const { db, useCase } = montar();
    db.seedOrder({ id: 'order-1', customerName: 'Cliente fail teste' });

    await expect(useCase.execute(COMANDO)).rejects.toBeInstanceOf(TransientError);

    expect(db.orderById('order-1').status).toBe(OrderStatus.PENDING);
    expect(db.stockOf('Teclado')).toBe(5);
    expect(db.inbox).toHaveLength(0);
  });

  it('registra o numero de tentativas ao falhar', async () => {
    const { db, useCase } = montar(0);
    db.seedOrder({ id: 'order-1' });

    await useCase.execute({ ...COMANDO, attempt: 4 });

    expect(db.orderById('order-1').processingAttempts).toBe(4);
  });

  // As três camadas de idempotência se protegem umas às outras — e é por isso
  // que uma pode ser removida sem nenhum teste reclamar: as outras duas seguram
  // o resultado final. Os testes abaixo isolam cada camada para provar que ela
  // sozinha faz o trabalho dela. Foram escritos para matar mutantes que o
  // Stryker deixou vivos exatamente aqui.
  describe('camada 1 — a inbox, por si só', () => {
    it('barra a entrega repetida antes de tocar no pedido ou no estoque', async () => {
      const { db, useCase } = montar();
      db.seedOrder({ id: 'order-1' });
      // O pedido segue PENDING: sem a camada 1, o fluxo passaria direto por ele.
      db.inbox.push({ consumer: COMANDO.consumer, eventId: COMANDO.eventId });

      await expect(useCase.execute(COMANDO)).resolves.toBe('DUPLICATE');

      expect(db.orderById('order-1').status).toBe(OrderStatus.PENDING);
      expect(db.stockOf('Teclado')).toBe(5);
      expect(db.reservations).toHaveLength(0);
    });
  });

  describe('camada 2 — o UPDATE condicional de status, por si só', () => {
    /** Perde a corrida do `UPDATE ... WHERE status = 'PENDING'`: affectedRows = 0. */
    const unitOfWorkQuePerdeACorrida = (db: InMemoryDatabase): InMemoryUnitOfWork => {
      const unitOfWork = new InMemoryUnitOfWork(db);
      const original = unitOfWork.runInTransaction.bind(unitOfWork);
      unitOfWork.runInTransaction = (work) =>
        original((repositories) =>
          work({
            ...repositories,
            orders: Object.assign(Object.create(Object.getPrototypeOf(repositories.orders)), repositories.orders, {
              transitionStatus: async () => false,
            }),
          }),
        );
      return unitOfWork;
    };

    it('não reserva estoque quando outro consumidor já levou o pedido', async () => {
      const db = InMemoryDatabase.withCatalog(['Teclado', 5], ['Mouse', 5]);
      db.seedOrder({ id: 'order-1' });
      const useCase = new ProcessOrderUseCase(unitOfWorkQuePerdeACorrida(db), new FixedClock(), 0);

      await expect(useCase.execute(COMANDO)).resolves.toBe('DUPLICATE');

      expect(db.stockOf('Teclado')).toBe(5);
      expect(db.reservations).toHaveLength(0);
    });
  });

  describe('atraso simulado de processamento', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    /** Relógio falso, mas `setImmediate` real — é com ele que esgotamos os microtasks. */
    const comRelogioFalso = (): void => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    };
    const esgotarMicrotasks = (): Promise<void> =>
      new Promise((resolve) => {
        setImmediate(resolve);
      });

    it('com PROCESSING_DELAY_MS = 0 não agenda espera nenhuma', async () => {
      comRelogioFalso();
      const db = InMemoryDatabase.withCatalog(['Teclado', 5]);
      db.seedOrder({ id: 'order-1' });
      const useCase = new ProcessOrderUseCase(new InMemoryUnitOfWork(db), new FixedClock(), 0);

      // Sem avançar um milissegundo sequer no relógio falso: se o código
      // agendasse um setTimeout, esta promessa nunca resolveria.
      await expect(useCase.execute(COMANDO)).resolves.toBe('PROCESSED');
    });

    it('com PROCESSING_DELAY_MS > 0 espera antes de processar', async () => {
      comRelogioFalso();
      const db = InMemoryDatabase.withCatalog(['Teclado', 5]);
      db.seedOrder({ id: 'order-1' });
      const useCase = new ProcessOrderUseCase(new InMemoryUnitOfWork(db), new FixedClock(), 50);

      const execucao = useCase.execute(COMANDO);

      // Todos os microtasks já correram. Se a espera não existisse, o pedido
      // já teria sido processado aqui — é esta asserção que prova que ela existe.
      await esgotarMicrotasks();
      expect(db.orderById('order-1').status).toBe(OrderStatus.PENDING);

      jest.advanceTimersByTime(50);
      await expect(execucao).resolves.toBe('PROCESSED');
    });
  });
});
