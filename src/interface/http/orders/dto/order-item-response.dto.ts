import { ApiProperty } from '@nestjs/swagger';

export class OrderItemResponseDto {
  @ApiProperty({ example: 'Teclado Mecanico' })
  productName!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: '249.90', description: 'Decimal como string, nunca number.' })
  unitPrice!: string;

  @ApiProperty({ example: '499.80' })
  lineTotal!: string;
}
