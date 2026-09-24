export const TOKEN_VERIFIER = Symbol('TokenVerifier');

export interface VerifiedIdentity {
  readonly subject: string;
  readonly roles: readonly string[];
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}
