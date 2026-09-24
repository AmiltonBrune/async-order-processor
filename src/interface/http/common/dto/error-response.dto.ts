import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({
    example: 'INSUFFICIENT_STOCK',
    description:
      'Código estável para o cliente programar em cima. A mensagem pode mudar; o código, não.',
  })
  code!: string;

  @ApiProperty({ example: 'estoque insuficiente' })
  message!: string;

  @ApiProperty({
    nullable: true,
    example: '0193a000-0000-7000-8000-0000000000ff',
    description: 'O mesmo id do header x-correlation-id. É por ele que se investiga.',
  })
  correlationId!: string | null;

  @ApiProperty({ example: '2026-09-23T10:00:00.000Z', format: 'date-time' })
  timestamp!: string;
}
