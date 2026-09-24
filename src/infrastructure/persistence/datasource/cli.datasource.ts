import { DataSource } from 'typeorm';

import { loadEnv } from '../../config/env.schema';
import { dataSourceOptions } from './typeorm.datasource';

export default new DataSource(dataSourceOptions(loadEnv()));
