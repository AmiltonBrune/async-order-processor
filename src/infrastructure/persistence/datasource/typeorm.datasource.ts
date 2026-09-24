import { DataSourceOptions } from 'typeorm';

import { Env } from '../../config/env.schema';
import { ALL_ENTITIES } from '../entities';

export function dataSourceOptions(env: Env): DataSourceOptions {
  return {
    type: 'mysql',
    host: env.db.host,
    port: env.db.port,
    username: env.db.user,
    password: env.db.password,
    database: env.db.name,
    entities: ALL_ENTITIES,
    migrations: [`${__dirname}/../migrations/*.{ts,js}`],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    timezone: 'Z',
    extra: {
      connectionLimit: env.db.poolSize,
      decimalNumbers: false,
    },
  };
}
