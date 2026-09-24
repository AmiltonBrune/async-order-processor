import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateOrderUseCase } from '../../../application/create-order/create-order.use-case';
import { GetOrderUseCase } from '../../../application/get-order/get-order.use-case';
import { ListOrdersUseCase } from '../../../application/list-orders/list-orders.use-case';
import { ReprocessOrderUseCase } from '../../../application/reprocess-order/reprocess-order.use-case';
import { UserRole } from '../../../domain/user/user-role.enum';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import {
  DocumentaConsultaDePedido,
  DocumentaCriacaoDePedido,
  DocumentaListagemDePedidos,
  DocumentaReprocessamento,
} from '../docs/orders.api-docs';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { PaginatedOrdersDto } from './dto/paginated-orders.dto';
import { ReprocessAcceptedDto } from './dto/reprocess-accepted.dto';
import { OrderPresenter } from './order.presenter';

@ApiTags('orders')
@ApiBearerAuth('bearer')
@ApiResponse({ status: 401, description: 'Token ausente, expirado ou inválido.', type: ErrorResponseDto })
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly createOrder: CreateOrderUseCase,
    private readonly getOrder: GetOrderUseCase,
    private readonly listOrders: ListOrdersUseCase,
    private readonly reprocessOrder: ReprocessOrderUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @DocumentaCriacaoDePedido()
  async create(
    @Body() dto: CreateOrderDto,
    @CorrelationId() correlationId: string,
  ): Promise<OrderResponseDto> {
    const order = await this.createOrder.execute({
      customerName: dto.customerName,
      items: dto.items,
      correlationId,
    });
    return OrderPresenter.toResponse(order);
  }

  @Get()
  @DocumentaListagemDePedidos()
  async list(@Query() query: ListOrdersDto): Promise<PaginatedOrdersDto> {
    const result = await this.listOrders.execute(query);
    return { data: result.data.map(OrderPresenter.toResponse), meta: result.meta };
  }

  @Get(':id')
  @DocumentaConsultaDePedido()
  async byId(@Param('id', new ParseUUIDPipe()) id: string): Promise<OrderResponseDto> {
    return OrderPresenter.toResponse(await this.getOrder.execute(id));
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(UserRole.ADMIN)
  @DocumentaReprocessamento()
  async reprocess(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CorrelationId() correlationId: string,
  ): Promise<ReprocessAcceptedDto> {
    await this.reprocessOrder.execute(id, correlationId);
    return { status: 'PENDING' };
  }
}
