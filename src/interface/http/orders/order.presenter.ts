import { Order } from '../../../domain/order/order.entity';
import { OrderResponseDto } from './dto/order-response.dto';

export type OrderResponse = OrderResponseDto;

export class OrderPresenter {
  static toResponse(order: Order): OrderResponseDto {
    return {
      id: order.id,
      customerName: order.customerName,
      status: order.status,
      total: order.total.toFixed2(),
      currency: order.total.currency,
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed2(),
        lineTotal: item.lineTotal().toFixed2(),
      })),
      failureCode: order.failureCode,
      failureReason: order.failureReason,
      correlationId: order.correlationId,
      processedAt: order.processedAt === null ? null : order.processedAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
    };
  }
}
