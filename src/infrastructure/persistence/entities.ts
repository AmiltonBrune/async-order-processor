import { InboxEntity } from './inbox/inbox.entity-schema';
import { OrderItemEntity } from './order/order-item.entity-schema';
import { OrderEntity } from './order/order.entity-schema';
import { OutboxEntity } from './outbox/outbox.entity-schema';
import { ProductEntity } from './product/product.entity-schema';
import { StockReservationEntity } from './stock/stock-reservation.entity-schema';
import { UserEntity } from './user/user.entity-schema';

export const ALL_ENTITIES = [
  ProductEntity,
  OrderEntity,
  OrderItemEntity,
  StockReservationEntity,
  OutboxEntity,
  InboxEntity,
  UserEntity,
];
