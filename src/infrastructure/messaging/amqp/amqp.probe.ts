import { Injectable } from '@nestjs/common';

import { ReadinessProbe } from '../../../domain/ports/system/readiness-probe.port';
import { AmqpConnection } from './amqp.connection';

@Injectable()
export class AmqpProbe implements ReadinessProbe {
  readonly name = 'rabbitmq';

  constructor(private readonly amqp: AmqpConnection) {}

  async check(): Promise<boolean> {
    try {
      await this.amqp.getChannel();
      return true;
    } catch {
      return false;
    }
  }
}
