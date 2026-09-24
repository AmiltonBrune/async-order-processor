import { ApiProperty } from '@nestjs/swagger';

export class ReprocessAcceptedDto {
  @ApiProperty({ example: 'PENDING', description: 'Estado para o qual o pedido voltou.' })
  status!: string;
}
