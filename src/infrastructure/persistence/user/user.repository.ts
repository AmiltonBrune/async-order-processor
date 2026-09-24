import { QueryRunner } from 'typeorm';

import { UserRepository } from '../../../domain/ports/repositories/user.repository.port';
import { User } from '../../../domain/user/user.entity';
import { UserEntity } from './user.entity-schema';

export class TypeOrmUserRepository implements UserRepository {
  constructor(private readonly runner: QueryRunner) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.runner.manager.getRepository(UserEntity).findOne({ where: { email } });
    return row === null ? null : new User(row.id, row.email, row.passwordHash, row.role);
  }
}
