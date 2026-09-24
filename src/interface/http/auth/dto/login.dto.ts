import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'cliente@loja.test',
    description: 'Semeados por migration: cliente@loja.test (CUSTOMER) e admin@loja.test (ADMIN).',
  })
  @IsEmail({}, { message: 'email deve ser um endereço válido' })
  @MaxLength(160)
  email!: string;

  @ApiProperty({
    example: 'cliente123',
    description: 'Senha do usuário semeado. admin@loja.test usa admin123.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
