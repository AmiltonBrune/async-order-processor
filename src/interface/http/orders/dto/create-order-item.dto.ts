import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

const DECIMAL_12_2 = /^\d{1,10}(\.\d{1,2})?$/;

export class CreateOrderItemDto {
  @ApiProperty({ example: 'Teclado Mecanico' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  productName!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    example: '249.90',
    description: 'Decimal como string. Numero em JSON perderia precisao antes de chegar aqui.',
  })
  @IsString()
  @Matches(DECIMAL_12_2, { message: 'price deve ser decimal com no maximo 2 casas, como "249.90"' })
  price!: string;
}
