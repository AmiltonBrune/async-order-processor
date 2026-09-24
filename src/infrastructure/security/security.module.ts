import { ENV } from '../config/config.constants';
import { Global, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { CREDENTIALS_AUTHENTICATOR } from '../../domain/ports/system/credentials-authenticator.port';
import { PASSWORD_HASHER } from '../../domain/ports/system/password-hasher.port';
import { TOKEN_ISSUER, TokenIssuer } from '../../domain/ports/system/token-issuer.port';
import { TOKEN_VERIFIER } from '../../domain/ports/system/token-verifier.port';
import { USER_REPOSITORY, UserRepository } from '../../domain/ports/repositories/user.repository.port';
import { Env } from '../config/env.schema';
import { JwtTokenIssuer } from './tokens/jwt.issuer';
import { KeycloakCredentialsAuthenticator } from './keycloak/keycloak-credentials.authenticator';
import { KeycloakJwksVerifier } from './keycloak/keycloak-jwks.verifier';
import { LocalCredentialsAuthenticator } from './authentication/local-credentials.authenticator';
import { LocalJwtVerifier } from './tokens/local-jwt.verifier';
import { ScryptPasswordHasher } from './hashing/scrypt.hasher';
import { PasswordHasher } from '../../domain/ports/system/password-hasher.port';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ secret: env.jwtSecret, signOptions: { algorithm: 'HS256' } }),
    }),
  ],
  providers: [
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    {
      provide: TOKEN_ISSUER,
      inject: [JwtService, ENV],
      useFactory: (jwt: JwtService, env: Env) => new JwtTokenIssuer(jwt, env.jwtExpiresInSeconds),
    },
    {
      provide: TOKEN_VERIFIER,
      inject: [JwtService, ENV],
      useFactory: (jwt: JwtService, env: Env) =>
        env.authProvider === 'keycloak'
          ? new KeycloakJwksVerifier(jwt, env.keycloak.issuer, env.keycloak.clientId)
          : new LocalJwtVerifier(jwt),
    },
    {
      provide: CREDENTIALS_AUTHENTICATOR,
      inject: [ENV, USER_REPOSITORY, PASSWORD_HASHER, TOKEN_ISSUER],
      useFactory: (
        env: Env,
        users: UserRepository,
        hasher: PasswordHasher,
        issuer: TokenIssuer,
      ) =>
        env.authProvider === 'keycloak'
          ? new KeycloakCredentialsAuthenticator(
              env.keycloak.issuer,
              env.keycloak.clientId,
              env.keycloak.clientSecret,
            )
          : new LocalCredentialsAuthenticator(users, hasher, issuer),
    },
  ],
  exports: [PASSWORD_HASHER, TOKEN_ISSUER, TOKEN_VERIFIER, CREDENTIALS_AUTHENTICATOR, JwtModule],
})
export class SecurityModule {}
