import { ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';

import { UserRole } from '../../../../domain/user/user-role.enum';
import { AuthenticatedUser } from '../guards/jwt-auth.guard';

const identidadeDe = (context: ExecutionContext): AuthenticatedUser => {
  const request = context
    .switchToHttp()
    .getRequest<{ user?: AuthenticatedUser } | undefined>();
  const user = request?.user;
  // O guard preenche `user` em toda rota não pública. Se chegou vazio aqui, a
  // rota foi marcada pública por engano — e a falha tem que ser fechada, nunca
  // "sem identidade, então vê tudo".
  if (user === undefined) throw new UnauthorizedException('Requisicao sem identidade');
  return user;
};

/** Subject do token — quem está criando o pedido. */
export const Requester = createParamDecorator(
  (_dados: unknown, context: ExecutionContext) => identidadeDe(context).sub,
);

/** `null` significa leitura irrestrita, e só o papel ADMIN a recebe. */
export const escopoDeLeitura = (user: AuthenticatedUser): string | null =>
  user.roles.includes(UserRole.ADMIN) ? null : user.sub;

export const OrderScope = createParamDecorator((_dados: unknown, context: ExecutionContext) =>
  escopoDeLeitura(identidadeDe(context)),
);

export const identidadeDoContexto = identidadeDe;
