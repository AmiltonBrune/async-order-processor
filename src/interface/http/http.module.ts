import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ApplicationModule } from '../../application/application.module';
import { CorrelationIdInterceptor } from '../../infrastructure/observability/correlation-id.interceptor';
import { AuthController } from './auth/auth.controller';
import { HealthController } from './health/health.controller';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OrdersController } from './orders/orders.controller';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [ApplicationModule],
  controllers: [OrdersController, AuthController, HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class HttpModule {}
