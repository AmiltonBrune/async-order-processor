import { Module } from '@nestjs/common';

import { CreateOrderUseCase } from './create-order/create-order.use-case';
import { GetOrderUseCase } from './get-order/get-order.use-case';
import { ListOrdersUseCase } from './list-orders/list-orders.use-case';
import { LoginUseCase } from './login/login.use-case';
import { ProcessOrderUseCase } from './process-order/process-order.use-case';
import { ReprocessOrderUseCase } from './reprocess-order/reprocess-order.use-case';

const USE_CASES = [
  CreateOrderUseCase,
  GetOrderUseCase,
  ListOrdersUseCase,
  LoginUseCase,
  ProcessOrderUseCase,
  ReprocessOrderUseCase,
];

@Module({ providers: USE_CASES, exports: USE_CASES })
export class ApplicationModule {}
