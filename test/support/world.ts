import { ENV } from '../../src/infrastructure/config/config.constants';
import { DEAD_QUEUE, MAIN_QUEUE } from '../../src/infrastructure/messaging/messaging.constants';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { setupSwagger } from '../../src/interface/http/docs/swagger.setup';
import { ProcessOrderUseCase } from '../../src/application/process-order/process-order.use-case';
import { Env } from '../../src/infrastructure/config/env.schema';
import { AmqpConnection } from '../../src/infrastructure/messaging/amqp/amqp.connection';
import { OrderConsumer } from '../../src/infrastructure/messaging/orders/order.consumer';
import { OrderPublisher } from '../../src/infrastructure/messaging/orders/order.publisher';
import { buildTopology } from '../../src/infrastructure/messaging/amqp/amqp.topology';
import { RelayWorker } from '../../src/workers/relay/relay.worker';

export interface OrderRowSnapshot {
  id: string;
  status: string;
  total_amount: string;
  failure_code: string | null;
  failure_reason: string | null;
  processing_attempts: number;
  correlation_id: string;
  processed_at: Date | null;
}

export class World {
  private static instance: World | null = null;

  private constructor(
    readonly app: INestApplication,
    readonly dataSource: DataSource,
    readonly env: Env,
  ) {}

  static async boot(): Promise<World> {
    if (World.instance !== null) return World.instance;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    setupSwagger(app);
    await app.init();
    World.instance = new World(app, app.get(DataSource), app.get<Env>(ENV));
    await World.instance.migrate();
    return World.instance;
  }

  static async shutdown(): Promise<void> {
    if (World.instance === null) return;
    await World.instance.desligarConsumidor();
    await World.instance.closeRawChannel();
    await World.instance.app.close();
    World.instance = null;
  }

  get publisher(): OrderPublisher {
    return this.app.get(OrderPublisher);
  }

  get consumer(): OrderConsumer {
    return this.app.get(OrderConsumer);
  }

  get processOrder(): ProcessOrderUseCase {
    return this.app.get(ProcessOrderUseCase);
  }

  get relay(): RelayWorker {
    return this.app.get(RelayWorker);
  }

  private consumerLigado = false;
  private relayLigado = false;

  async ligarConsumidor(): Promise<void> {
    if (this.consumerLigado) return;
    await this.consumer.start();
    this.consumerLigado = true;
  }

  async desligarConsumidor(): Promise<void> {
    if (!this.consumerLigado) return;
    await this.consumer.stop();
    this.consumerLigado = false;
  }

  ligarRelay(): void {
    if (this.relayLigado) return;
    this.relay.start();
    this.relayLigado = true;
  }

  get httpServer(): unknown {
    return this.app.getHttpServer();
  }

  private async migrate(): Promise<void> {
    await this.dataSource.runMigrations();
  }

  async reset(): Promise<void> {
    await this.desligarConsumidor();
    await this.dataSource.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'inbox_messages',
      'outbox_messages',
      'stock_reservations',
      'order_items',
      'orders',
      'products',
    ]) {
      await this.dataSource.query(`TRUNCATE TABLE ${table}`);
    }
    await this.dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
    await this.purgeQueues();
  }

  async seedCatalog(produtos: ReadonlyArray<{ nome: string; preco: string; estoque: number }>): Promise<void> {
    for (const produto of produtos) {
      await this.dataSource.query(`INSERT INTO products (name, price, stock) VALUES (?, ?, ?)`, [
        produto.nome,
        produto.preco,
        produto.estoque,
      ]);
    }
  }

  async productIdOf(nome: string): Promise<number> {
    const rows = (await this.dataSource.query(`SELECT id FROM products WHERE name = ?`, [
      nome,
    ])) as Array<{ id: number }>;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`Produto ausente no catalogo de teste: ${nome}`);
    return Number(id);
  }

  async stockOf(nome: string): Promise<number> {
    const rows = (await this.dataSource.query(`SELECT stock FROM products WHERE name = ?`, [
      nome,
    ])) as Array<{ stock: number }>;
    return Number(rows[0]?.stock ?? -1);
  }

  async orderById(id: string): Promise<OrderRowSnapshot> {
    const rows = (await this.dataSource.query(`SELECT * FROM orders WHERE id = ?`, [
      id,
    ])) as OrderRowSnapshot[];
    const row = rows[0];
    if (row === undefined) throw new Error(`Pedido ausente: ${id}`);
    return row;
  }

  async countRows(table: string, where = '1=1', params: unknown[] = []): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`,
      params,
    )) as Array<{ total: number | string }>;
    return Number(rows[0]?.total ?? 0);
  }

  async sumReservations(orderId?: string): Promise<number> {
    const rows = (await this.dataSource.query(
      orderId === undefined
        ? `SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_reservations`
        : `SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_reservations WHERE order_id = ?`,
      orderId === undefined ? [] : [orderId],
    )) as Array<{ total: number | string }>;
    return Number(rows[0]?.total ?? 0);
  }

  /** Espera ativa com limite: teste que espera para sempre trava o CI inteiro. */
  async waitFor<T>(
    descricao: string,
    condicao: () => Promise<T | null>,
    timeoutMs = 15_000,
  ): Promise<T> {
    const limite = Date.now() + timeoutMs;
    let ultimo: T | null = null;
    while (Date.now() < limite) {
      ultimo = await condicao();
      if (ultimo !== null) return ultimo;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Tempo esgotado esperando: ${descricao} (ultimo valor: ${String(ultimo)})`);
  }

  async purgeQueues(): Promise<void> {
    const channel = await this.rawChannel();
    for (const queue of buildTopology(this.env.retryTiersMs).queues) {
      await channel.purgeQueue(queue.name).catch(() => undefined);
    }
  }

  /** Publica conteúdo cru na fila — usado para simular mensagem corrompida. */
  async publicarBruto(queue: string, content: Buffer): Promise<void> {
    const channel = await this.rawChannel();
    channel.sendToQueue(queue, content, { persistent: true });
    await channel.waitForConfirms();
  }

  async queueDepth(queue: string): Promise<number> {
    const channel = await this.rawChannel();
    const info = await channel.checkQueue(queue);
    return info.messageCount;
  }

  async firstMessageOf(
    queue: string,
  ): Promise<{ headers: Record<string, unknown>; payload: Record<string, unknown> } | null> {
    const channel = await this.rawChannel();
    const message = await channel.get(queue, { noAck: true });
    if (message === false) return null;
    return {
      headers: (message.properties.headers ?? {}) as Record<string, unknown>,
      payload: JSON.parse(message.content.toString('utf8')) as Record<string, unknown>,
    };
  }

  private rawConnection: ChannelModel | null = null;
  private rawChannelRef: ConfirmChannel | null = null;

  /** Canal proprio do teste: inspecionar fila nao pode interferir no consumidor. */
  private async rawChannel(): Promise<ConfirmChannel> {
    if (this.rawChannelRef !== null) return this.rawChannelRef;
    this.rawConnection = await connect(this.env.amqpUrl);
    this.rawChannelRef = await this.rawConnection.createConfirmChannel();
    await this.app.get(AmqpConnection).getChannel();
    return this.rawChannelRef;
  }

  private async closeRawChannel(): Promise<void> {
    await this.rawChannelRef?.close().catch(() => undefined);
    await this.rawConnection?.close().catch(() => undefined);
    this.rawChannelRef = null;
    this.rawConnection = null;
  }

  static readonly MAIN_QUEUE = MAIN_QUEUE;
  static readonly DEAD_QUEUE = DEAD_QUEUE;
}
