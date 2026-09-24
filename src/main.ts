import { ENV } from './infrastructure/config/config.constants';
import { LOGGER } from './infrastructure/observability/correlation.constants';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';

import { AppModule } from './app.module';
import { Env } from './infrastructure/config/env.schema';
import { StructuredLogger } from './infrastructure/observability/pino.logger';
import { setupSwagger } from './interface/http/docs/swagger.setup';
import { ConsumerWorker } from './workers/consumer/consumer.worker';
import { RelayWorker } from './workers/relay/relay.worker';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  const logger = app.get<StructuredLogger>(LOGGER);
  app.useLogger(logger);
  app.enableShutdownHooks();
  await iniciarPapel(app, env, logger);
}

export async function iniciarPapel(
  app: INestApplication,
  env: Env,
  logger: StructuredLogger,
  iniciarApi: typeof startApi = startApi,
): Promise<void> {
  switch (env.appRole) {
    case 'api':
      await iniciarApi(app, env, logger);
      return;
    case 'relay':
      await app.init();
      app.get(RelayWorker).start();
      logger.log('Papel relay ativo');
      return;
    case 'consumer':
      await app.init();
      await app.get(ConsumerWorker).start();
      logger.log('Papel consumer ativo');
      return;
    default:
      throw new Error(`Papel desconhecido: ${String(env.appRole)}`);
  }
}

export async function startApi(app: INestApplication, env: Env, logger: StructuredLogger): Promise<void> {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Sem isto, `page=2` chega como a string "2" e a validacao de inteiro
      // recusa toda query string valida.
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  setupSwagger(app);

  await app.listen(env.httpPort);
  logger.log('API ouvindo', {
    porta: env.httpPort,
    docs: `http://localhost:${env.httpPort}/docs`,
  });
}

/* istanbul ignore next -- guarda de entrypoint: inalcançável sob o runner de teste */
if (require.main === module) {
  void bootstrap();
}
