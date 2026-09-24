import { Inject, Injectable } from '@nestjs/common';

import { USER_REPOSITORY, UserRepository } from '../../../domain/ports/repositories/user.repository.port';
import { AccessToken } from '../../../domain/ports/system/access-token.port';
import { CredentialsAuthenticator } from '../../../domain/ports/system/credentials-authenticator.port';
import { PASSWORD_HASHER, PasswordHasher } from '../../../domain/ports/system/password-hasher.port';
import { TOKEN_ISSUER, TokenIssuer } from '../../../domain/ports/system/token-issuer.port';

@Injectable()
export class LocalCredentialsAuthenticator implements CredentialsAuthenticator {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
  ) {}

  async authenticate(email: string, password: string): Promise<AccessToken | null> {
    const user = await this.users.findByEmail(email);
    if (user === null) {
      await this.hasher.verify(password, '');
      return null;
    }
    const confere = await this.hasher.verify(password, user.passwordHash);
    return confere ? this.tokens.issue(user.id, user.role) : null;
  }
}
