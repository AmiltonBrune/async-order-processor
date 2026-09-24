import { ENV } from '../../config/config.constants';
import { LOGGER } from '../../observability/correlation.constants';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';

import { Env } from '../../config/env.schema';
import { StructuredLogger } from '../../observability/pino.logger';
import { buildTopology } from './amqp.topology';

@Injectable()
export class AmqpConnection implements OnApplicationShutdown {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async getChannel(): Promise<ConfirmChannel> {
    if (this.channel !== null) return this.channel;

    const connection = await connect(this.env.amqpUrl, { heartbeat: 15 });
    connection.on('error', (error: Error) => {
      this.logger.error('Conexao AMQP com erro', { erro: error.message });
    });
    connection.on('close', () => {
      this.connection = null;
      this.channel = null;
    });

    const channel = await connection.createConfirmChannel();
    await channel.prefetch(this.env.prefetch);
    await this.declareTopology(channel);

    this.connection = connection;
    this.channel = channel;
    return channel;
  }

  private async declareTopology(channel: ConfirmChannel): Promise<void> {
    const topology = buildTopology(this.env.retryTiersMs);
    for (const exchange of topology.exchanges) {
      await channel.assertExchange(exchange.name, exchange.type, { durable: true });
    }
    for (const queue of topology.queues) {
      await channel.assertQueue(queue.name, { durable: true, arguments: queue.args });
      await channel.bindQueue(queue.name, queue.exchange, queue.routingKey);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.fecharIgnorandoFalhaDeEncerramento();
    this.channel = null;
    this.connection = null;
  }

  private async fecharIgnorandoFalhaDeEncerramento(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (falhaDeEncerramento) {
      this.logger.debug('Falha ao fechar a conexao AMQP no shutdown', {
        erro: falhaDeEncerramento instanceof Error ? falhaDeEncerramento.message : 'desconhecido',
      });
    }
  }
}
