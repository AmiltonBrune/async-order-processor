import { QueryRunner } from 'typeorm';

import { InboxRepository } from '../../../domain/ports/repositories/inbox.repository.port';
import { isDuplicateEntry } from '../errors/mysql.errors';
import { InboxEntity } from './inbox.entity-schema';

export class TypeOrmInboxRepository implements InboxRepository {
  constructor(private readonly runner: QueryRunner) {}

  async register(
    consumer: string,
    eventId: string,
    orderId: string,
    at: Date,
  ): Promise<boolean> {
    try {
      await this.runner.manager
        .getRepository(InboxEntity)
        .insert({ consumer, eventId, orderId, processedAt: at });
      return true;
    } catch (error) {
      if (isDuplicateEntry(error)) return false;
      throw error;
    }
  }
}
