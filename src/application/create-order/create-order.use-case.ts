import { Inject, Injectable } from '@nestjs/common';

import { OrderCreatedEvent } from '../../domain/order/events/order-created.event';
import { OrderItem } from '../../domain/order/order-item.entity';
import { Order } from '../../domain/order/order.entity';
import { Product } from '../../domain/product/product.entity';
import { CLOCK, Clock } from '../../domain/ports/system/clock.port';
import { ID_GENERATOR, IdGenerator } from '../../domain/ports/system/id-generator.port';
import { UNIT_OF_WORK, UnitOfWork } from '../../domain/ports/unit-of-work.port';
import { BusinessRuleViolation, ValidationError } from '../../domain/shared/errors';
import { Money } from '../../domain/shared/money.vo';
import { CreateOrderCommand } from './create-order.command';

@Injectable()
export class CreateOrderUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(command: CreateOrderCommand): Promise<Order> {
    this.assertNoDuplicateProduct(command);

    return this.unitOfWork.runInTransaction(async (repositories) => {
      const names = command.items.map((item) => item.productName);
      const catalog = await repositories.products.findByNames(names);
      const items = command.items.map((item) => this.toOrderItem(item, catalog));

      const now = this.clock.now();
      const order = Order.create({
        id: this.ids.next(),
        customerName: command.customerName,
        createdBy: command.createdBy,
        items,
        correlationId: command.correlationId,
        now,
      });

      await repositories.orders.insert(order);
      await repositories.outbox.append(
        new OrderCreatedEvent(this.ids.next(), order.id, command.correlationId, now),
      );
      return order;
    });
  }

  private toOrderItem(
    input: { productName: string; price: string; quantity: number },
    catalog: readonly Product[],
  ): OrderItem {
    const product = catalog.find((candidate) => candidate.name === input.productName);
    if (product === undefined) {
      throw new BusinessRuleViolation(
        'PRODUCT_NOT_FOUND',
        `Produto nao encontrado no catalogo: ${input.productName}`,
      );
    }
    // ADR-014: o preco vem do payload porque o enunciado manda. Em producao
    // viria de `product.price`, e o campo do payload seria no maximo um "preco
    // esperado" usado para detectar catalogo desatualizado.
    return new OrderItem(product.id, product.name, Money.of(input.price), input.quantity);
  }

  private assertNoDuplicateProduct(command: CreateOrderCommand): void {
    const names = command.items.map((item) => item.productName);
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicated.length > 0) {
      // UNIQUE(order_id, product_id) recusaria no banco de qualquer forma. Aqui
      // o cliente recebe 400 com o nome do produto em vez de 500 com erro de
      // chave duplicada.
      throw new ValidationError(
        'DUPLICATE_PRODUCT_IN_ORDER',
        `Produto repetido no pedido: ${[...new Set(duplicated)].join(', ')}`,
      );
    }
  }
}
