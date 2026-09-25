import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { UserRole } from '../../src/domain/user/user-role.enum';
import {
  escopoDeLeitura,
  identidadeDoContexto,
} from '../../src/interface/http/common/decorators/requester.decorator';

const contexto = (request: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('escopoDeLeitura', () => {
  it('limita o cliente aos próprios pedidos', () => {
    expect(escopoDeLeitura({ sub: 'ana@loja.test', roles: [UserRole.CUSTOMER] })).toBe(
      'ana@loja.test',
    );
  });

  it('libera o ADMIN de qualquer escopo', () => {
    expect(escopoDeLeitura({ sub: 'admin@loja.test', roles: [UserRole.ADMIN] })).toBeNull();
  });

  it('o ADMIN continua irrestrito quando acumula papéis', () => {
    expect(
      escopoDeLeitura({ sub: 'admin@loja.test', roles: [UserRole.CUSTOMER, UserRole.ADMIN] }),
    ).toBeNull();
  });

  it('papel desconhecido não libera nada', () => {
    expect(escopoDeLeitura({ sub: 'x@loja.test', roles: ['SUPORTE'] })).toBe('x@loja.test');
  });

  it('sem papel algum o escopo continua sendo o próprio subject', () => {
    expect(escopoDeLeitura({ sub: 'x@loja.test', roles: [] })).toBe('x@loja.test');
  });
});

describe('identidade do contexto', () => {
  it('entrega o que o guard gravou no request', () => {
    const user = { sub: 'ana@loja.test', roles: [UserRole.CUSTOMER] };
    expect(identidadeDoContexto(contexto({ user }))).toBe(user);
  });

  // Falha fechada: sem identidade a resposta é 401, nunca "vê tudo".
  it.each([
    ['request sem user', {}],
    ['sem request algum', undefined],
  ])('recusa a requisição sem identidade — %s', (_caso, request) => {
    expect(() => identidadeDoContexto(contexto(request))).toThrow(UnauthorizedException);
  });
});
