import { Module } from '@nestjs/common';

import { ApplicationModule } from './application/application.module';
import { ConfigModule } from './infrastructure/config/config.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { ReadinessModule } from './readiness.module';
import { SecurityModule } from './infrastructure/security/security.module';
import { HttpModule } from './interface/http/http.module';
import { ConsumerModule } from './workers/consumer/consumer.module';
import { RelayModule } from './workers/relay/relay.module';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    PersistenceModule,
    MessagingModule,
    ReadinessModule,
    SecurityModule,
    ApplicationModule,
    HttpModule,
    RelayModule,
    ConsumerModule,
  ],
})
export class AppModule {}
