import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { AccessToken } from '../../domain/ports/system/access-token.port';
import { CREDENTIALS_AUTHENTICATOR, CredentialsAuthenticator } from '../../domain/ports/system/credentials-authenticator.port';

@Injectable()
export class LoginUseCase {
  private static readonly MESSAGE = 'Credenciais invalidas';

  constructor(
    @Inject(CREDENTIALS_AUTHENTICATOR)
    private readonly authenticator: CredentialsAuthenticator,
  ) {}

  async execute(email: string, password: string): Promise<AccessToken> {
    const token = await this.authenticator.authenticate(email, password);
    if (token === null) {
      throw new UnauthorizedException(LoginUseCase.MESSAGE);
    }
    return token;
  }
}
