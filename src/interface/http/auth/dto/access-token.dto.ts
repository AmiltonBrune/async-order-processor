import { ApiProperty } from '@nestjs/swagger';

export class AccessTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Cole em Authorize (canto superior direito) para liberar as rotas de pedido.',
  })
  accessToken!: string;

  @ApiProperty({ example: 3600, description: 'Segundos até expirar.' })
  expiresIn!: number;
}
