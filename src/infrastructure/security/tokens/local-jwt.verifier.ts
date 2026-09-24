import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TokenVerifier, VerifiedIdentity } from '../../../domain/ports/system/token-verifier.port';

@Injectable()
export class LocalJwtVerifier implements TokenVerifier {
  constructor(private readonly jwt: JwtService) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    const payload = await this.jwt.verifyAsync<{ sub: string; role?: string }>(token);
    return {
      subject: payload.sub,
      roles: typeof payload.role === 'string' && payload.role !== '' ? [payload.role] : [],
    };
  }
}
