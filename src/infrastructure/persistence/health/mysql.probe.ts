import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReadinessProbe } from '../../../domain/ports/system/readiness-probe.port';

@Injectable()
export class MySqlProbe implements ReadinessProbe {
  readonly name = 'mysql';

  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
