import { Module } from '@nestjs/common';

import { ApplicationModule } from '../../application/application.module';
import { ConsumerWorker } from './consumer.worker';

@Module({ imports: [ApplicationModule], providers: [ConsumerWorker], exports: [ConsumerWorker] })
export class ConsumerModule {}
