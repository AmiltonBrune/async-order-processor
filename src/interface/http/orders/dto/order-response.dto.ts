import { ApiProperty } from '@nestjs/swagger';

import { OrderStatus } from '../../../../domain/order/order-status.enum';
import { OrderItemResponseDto } from './order-item-response.dto';

export class OrderResponseDto {
  @ApiProperty({ example: '0193a000-0000-7000-8000-000000000001', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ana Souza' })
  customerName!: string;

  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.PENDING,
    description:
      'Nasce PENDING. O worker leva a PROCESSED ou FAILED — a API nunca devolve o pedido já processado no POST.',
  })
  status!: string;

  @ApiProperty({ example: '769.50', description: 'Soma de unitPrice × quantity, em decimal.' })
  total!: string;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'INSUFFICIENT_STOCK, PRODUCT_NOT_FOUND ou RETRIES_EXHAUSTED quando FAILED.',
  })
  failureCode!: string | null;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'A mensagem REAL do erro quando FAILED — ex.: "estoque insuficiente".',
  })
  failureReason!: string | null;

  @ApiProperty({
    example: '0193a000-0000-7000-8000-0000000000ff',
    description: 'Cole este id no chamado: ele aparece nos logs da API, do relay e do worker.',
  })
  correlationId!: string;

  @ApiProperty({ nullable: true, example: null, format: 'date-time' })
  processedAt!: string | null;

  @ApiProperty({ example: '2026-09-23T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;
}
