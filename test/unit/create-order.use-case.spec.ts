import { CreateOrderUseCase } from '../../src/application/create-order/create-order.use-case';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { BusinessRuleViolation, ValidationError } from '../../src/domain/shared/errors';
import {
  FixedClock,
  InMemoryDatabase,
  InMemoryUnitOfWork,
  SequentialIdGenerator,
} from '../support/in-memory';

const montar = () => {
  const db = InMemoryDatabase.withCatalog(['Teclado', 5], ['Mouse', 5]);
  const unitOfWork = new InMemoryUnitOfWork(db);
  const useCase = new CreateOrderUseCase(unitOfWork, new FixedClock(), new SequentialIdGenerator());
  return { db, unitOfWork, useCase };
};

const comando = {
  customerName: 'Ana Souza',
  items: [
    { productName: 'Teclado', price: '10.00', quantity: 2 },
    { productName: 'Mouse', price: '3.33', quantity: 3 },
  ],
  correlationId: 'corr-1',
};

describe('CreateOrderUseCase', () => {
  it('cria o pedido PENDING com o total somado pelo dominio', async () => {
    const { useCase } = montar();
    const pedido = await useCase.execute(comando);
    expect(pedido.status).toBe(OrderStatus.PENDING);
    expect(pedido.total.toFixed2()).toBe('29.99');
    expect(pedido.items).toHaveLength(2);
  });

  it('grava pedido e evento na MESMA transacao', async () => {
    const { db, unitOfWork, useCase } = montar();
    await useCase.execute(comando);
    expect(unitOfWork.transactions).toBe(1);
    expect(db.orders).toHaveLength(1);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]?.orderId).toBe(db.orders[0]?.id);
  });

  it('propaga o correlationId do pedido para o evento', async () => {
    const { db, useCase } = montar();
    await useCase.execute(comando);
    expect(db.outbox[0]?.correlationId).toBe('corr-1');
    expect(db.orders[0]?.correlationId).toBe('corr-1');
  });

  it('nao toca no estoque — validar existencia nao e validar disponibilidade', async () => {
    const { db, useCase } = montar();
    await useCase.execute({ ...comando, items: [{ productName: 'Teclado', price: '10.00', quantity: 99 }] });
    expect(db.stockOf('Teclado')).toBe(5);
    expect(db.reservations).toHaveLength(0);
    expect(db.orders[0]?.status).toBe(OrderStatus.PENDING);
  });

  it('recusa produto fora do catalogo sem gravar nada', async () => {
    const { db, useCase } = montar();
    await expect(
      useCase.execute({ ...comando, items: [{ productName: 'Nao existe', price: '1.00', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(BusinessRuleViolation);
    expect(db.orders).toHaveLength(0);
    expect(db.outbox).toHaveLength(0);
  });

  it('reverte o pedido quando a gravacao do evento falha', async () => {
    const { db, unitOfWork, useCase } = montar();
    jest
      .spyOn(unitOfWork, 'runInTransaction')
      .mockImplementationOnce(async (work) => {
        const original = InMemoryUnitOfWork.prototype.runInTransaction.bind(unitOfWork);
        return original(async (repositories) => {
          const resultado = await work({
            ...repositories,
            outbox: {
              append: async () => {
                throw new Error('falha forcada no INSERT da outbox');
              },
            },
          });
          return resultado;
        });
      });

    await expect(useCase.execute(comando)).rejects.toThrow('falha forcada no INSERT da outbox');
    expect(db.orders).toHaveLength(0);
    expect(db.outbox).toHaveLength(0);
  });

  it('recusa o mesmo produto repetido no pedido', async () => {
    const { db, useCase } = montar();
    await expect(
      useCase.execute({
        ...comando,
        items: [
          { productName: 'Teclado', price: '10.00', quantity: 1 },
          { productName: 'Teclado', price: '10.00', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(db.orders).toHaveLength(0);
  });

  it('usa ids distintos para o pedido e para o evento', async () => {
    const { db, useCase } = montar();
    await useCase.execute(comando);
    expect(db.outbox[0]?.eventId).not.toBe(db.orders[0]?.id);
  });

  // Com UM item o catálogo devolvido tem um produto só, e qualquer busca acerta
  // por acidente. São precisos dois itens para provar que cada um casa com o
  // seu produto, em vez de todos pegarem o primeiro da lista.
  it('casa cada item com o produto certo do catálogo, não com o primeiro', async () => {
    const { useCase } = montar();
    const pedido = await useCase.execute(comando);

    expect(pedido.items.map((item) => [item.productId, item.productName])).toEqual([
      [1, 'Teclado'],
      [2, 'Mouse'],
    ]);
  });

  it('o erro de produto repetido nomeia o produto, uma vez só', async () => {
    const { useCase } = montar();
    const erro: unknown = await useCase
      .execute({
        customerName: 'Ana Souza',
        items: [
          { productName: 'Teclado', price: '10.00', quantity: 1 },
          { productName: 'Teclado', price: '10.00', quantity: 2 },
          { productName: 'Teclado', price: '10.00', quantity: 3 },
        ],
        correlationId: 'corr-1',
      })
      .catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(ValidationError);
    const mensagem = (erro as ValidationError).message;
    expect(mensagem).toContain('Teclado');
    expect(mensagem.match(/Teclado/g)).toHaveLength(1);
  });
});
