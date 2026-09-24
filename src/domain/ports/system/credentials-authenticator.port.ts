import { AccessToken } from './access-token.port';

export const CREDENTIALS_AUTHENTICATOR = Symbol('CredentialsAuthenticator');

export interface CredentialsAuthenticator {
  authenticate(email: string, password: string): Promise<AccessToken | null>;
}
