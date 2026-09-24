import { Module } from '@nestjs/common';

import { RelayWorker } from './relay.worker';

@Module({ providers: [RelayWorker], exports: [RelayWorker] })
export class RelayModule {}
