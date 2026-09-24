import { Injectable, OnApplicationShutdown } from '@nestjs/common';

import { OrderConsumer } from '../../infrastructure/messaging/orders/order.consumer';

@Injectable()
export class ConsumerWorker implements OnApplicationShutdown {
  constructor(private readonly consumer: OrderConsumer) {}

  async start(): Promise<void> {
    await this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.stop();
  }
}
