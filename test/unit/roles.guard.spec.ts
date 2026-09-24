import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '../../src/domain/user/user-role.enum';
import { RolesGuard } from '../../src/interface/http/common/guards/roles.guard';

const contexto = (papelDoUsuario: string | undefined, exigidos: UserRole[] | undefined) => {
  const reflector = { getAllAndOverride: () => exigidos } as unknown as Reflector;
  const request =
    papelDoUsuario === undefined ? {} : { user: { sub: 'u', roles: papelDoUsuario.split(',') } };
  const execution = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(reflector), execution };
};

describe('RolesGuard', () => {
  it('libera rota sem exigência de papel', () => {
    const { guard, execution } = contexto('CUSTOMER', undefined);
    expect(guard.canActivate(execution)).toBe(true);
  });

  it('libera rota com lista de papéis vazia', () => {
    const { guard, execution } = contexto('CUSTOMER', []);
    expect(guard.canActivate(execution)).toBe(true);
  });

  it('libera quem tem o papel exigido', () => {
    const { guard, execution } = contexto('ADMIN', [UserRole.ADMIN]);
    expect(guard.canActivate(execution)).toBe(true);
  });

  it('recusa com 403, não 401, quando o papel é insuficiente', () => {
    const { guard, execution } = contexto('CUSTOMER', [UserRole.ADMIN]);
    expect(() => guard.canActivate(execution)).toThrow(ForbiddenException);
  });

  it('recusa quando não há usuário no request', () => {
    const { guard, execution } = contexto(undefined, [UserRole.ADMIN]);
    expect(() => guard.canActivate(execution)).toThrow(ForbiddenException);
  });

  it('recusa papel desconhecido que não está na lista', () => {
    const { guard, execution } = contexto('SUPERUSER', [UserRole.ADMIN]);
    expect(() => guard.canActivate(execution)).toThrow(ForbiddenException);
  });

  it('basta UM dos papéis do portador casar com o exigido', () => {
    const { guard, execution } = contexto('CUSTOMER,ADMIN', [UserRole.ADMIN]);
    expect(guard.canActivate(execution)).toBe(true);
  });

  it('recusa portador sem nenhum papel', () => {
    const { guard, execution } = contexto('', [UserRole.ADMIN]);
    expect(() => guard.canActivate(execution)).toThrow(ForbiddenException);
  });
});
