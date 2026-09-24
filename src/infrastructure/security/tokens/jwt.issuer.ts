import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AccessToken } from '../../../domain/ports/system/access-token.port';
import { TokenIssuer } from '../../../domain/ports/system/token-issuer.port';

@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(
    private readonly jwt: JwtService,
    private readonly expiresInSeconds: number,
  ) {}

  async issue(subject: string, role: string): Promise<AccessToken> {
    const accessToken = await this.jwt.signAsync(
      { sub: subject, role },
      { expiresIn: this.expiresInSeconds },
    );
    return { accessToken, expiresIn: this.expiresInSeconds };
  }
}
