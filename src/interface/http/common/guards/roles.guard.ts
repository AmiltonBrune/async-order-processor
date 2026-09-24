import { REQUIRED_ROLES } from '../../http.constants';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '../../../../domain/user/user-role.enum';
import { AuthenticatedUser } from './jwt-auth.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const papeis = request.user?.roles ?? [];
    const autorizado = required.some((exigido) => papeis.includes(exigido));
    if (!autorizado) {
      throw new ForbiddenException('Papel insuficiente para esta operacao');
    }
    return true;
  }
}
