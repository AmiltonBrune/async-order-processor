import { LOGGER } from '../../../../infrastructure/observability/correlation.constants';
import { IS_PUBLIC } from '../../http.constants';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { TOKEN_VERIFIER, TokenVerifier } from '../../../../domain/ports/system/token-verifier.port';
import { StructuredLogger } from '../../../../infrastructure/observability/pino.logger';

export interface AuthenticatedUser {
  readonly sub: string;
  readonly roles: readonly string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(LOGGER) private readonly logger?: StructuredLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, unknown>;
      user?: AuthenticatedUser;
    }>();
    const token = JwtAuthGuard.bearerOf(request.headers['authorization']);
    if (token === null) throw new UnauthorizedException('Token ausente');

    try {
      const identidade = await this.verifier.verify(token);
      request.user = { sub: identidade.subject, roles: identidade.roles };
      return true;
    } catch (erro) {
      this.logger?.warn('Token recusado', {
        motivo: erro instanceof Error ? erro.message : String(erro),
      });
      throw new UnauthorizedException('Token invalido');
    }
  }

  private static bearerOf(header: unknown): string | null {
    if (typeof header !== 'string') return null;
    const [scheme, value] = header.split(' ');
    return scheme === 'Bearer' && value !== undefined && value !== '' ? value : null;
  }
}
