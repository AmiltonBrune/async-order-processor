import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { LoginUseCase } from '../../../application/login/login.use-case';
import { LoginDto } from './dto/login.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AccessTokenDto } from './dto/access-token.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly login: LoginUseCase) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Troca credenciais por um JWT',
    description:
      'Comece por aqui. Copie o `accessToken` da resposta, clique em **Authorize** no topo da ' +
      'página e cole — as rotas de pedido passam a funcionar.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      cliente: {
        summary: 'Cliente (CUSTOMER) — cria e consulta pedidos',
        value: { email: 'cliente@loja.test', password: 'cliente123' },
      },
      operador: {
        summary: 'Operador (ADMIN) — também reprocessa pedidos FAILED',
        value: { email: 'admin@loja.test', password: 'admin123' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Token emitido.', type: AccessTokenDto })
  @ApiResponse({
    status: 400,
    description: 'Corpo inválido (e-mail malformado, campo ausente).',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Credenciais inválidas. Senha errada e usuário inexistente devolvem exatamente a mesma ' +
      'resposta — diferenciá-las entregaria a lista de e-mails válidos.',
    type: ErrorResponseDto,
  })
  async authenticate(@Body() dto: LoginDto): Promise<AccessTokenDto> {
    return this.login.execute(dto.email, dto.password);
  }
}
