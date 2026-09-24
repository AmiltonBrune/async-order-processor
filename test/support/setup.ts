import 'reflect-metadata';

process.env['NODE_ENV'] = 'test';
process.env['APP_ROLE'] = process.env['APP_ROLE'] ?? 'api';
process.env['DB_HOST'] = process.env['DB_HOST'] ?? '127.0.0.1';
process.env['DB_PORT'] = process.env['DB_PORT'] ?? '33307';
process.env['DB_USER'] = process.env['DB_USER'] ?? 'orders';
process.env['DB_PASSWORD'] = process.env['DB_PASSWORD'] ?? 'orders';
process.env['DB_NAME'] = process.env['DB_NAME'] ?? 'orders_test';
process.env['AMQP_URL'] = process.env['AMQP_URL'] ?? 'amqp://orders:orders@127.0.0.1:5673';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'segredo-de-teste-nao-usar-em-producao';

process.env['RETRY_TIERS_MS'] = process.env['RETRY_TIERS_MS'] ?? '200,400,800';
process.env['PROCESSING_DELAY_MS'] = process.env['PROCESSING_DELAY_MS'] ?? '20';
process.env['OUTBOX_POLL_INTERVAL_MS'] = process.env['OUTBOX_POLL_INTERVAL_MS'] ?? '100';
process.env['LOG_LEVEL'] = process.env['LOG_LEVEL'] ?? 'silent';

jest.setTimeout(120_000);
