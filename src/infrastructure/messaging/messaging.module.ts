import { Global, Module } from '@nestjs/common';

import { ApplicationModule } from '../../application/application.module';
import { AmqpConnection } from './amqp/amqp.connection';
import { AmqpProbe } from './amqp/amqp.probe';
import { OrderConsumer } from './orders/order.consumer';
import { OrderPublisher } from './orders/order.publisher';

@Global()
@Module({
  imports: [ApplicationModule],
  providers: [AmqpConnection, OrderPublisher, OrderConsumer, AmqpProbe],
  exports: [AmqpConnection, OrderPublisher, OrderConsumer, AmqpProbe],
})
export class MessagingModule {}
