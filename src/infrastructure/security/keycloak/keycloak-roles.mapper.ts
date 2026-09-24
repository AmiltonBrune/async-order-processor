export interface KeycloakAccessTokenClaims {
  readonly sub?: unknown;
  readonly realm_access?: { readonly roles?: unknown };
  readonly resource_access?: Record<string, { readonly roles?: unknown }>;
}

export function mapearPapeis(
  claims: KeycloakAccessTokenClaims,
  conhecidos: readonly string[],
  clientId?: string,
): string[] {
  const doRealm = listaDeTextos(claims.realm_access?.roles);
  const doCliente =
    clientId === undefined ? [] : listaDeTextos(claims.resource_access?.[clientId]?.roles);

  const todos = new Set([...doRealm, ...doCliente].map((papel) => papel.toUpperCase()));
  return conhecidos.filter((papel) => todos.has(papel.toUpperCase()));
}

export function extrairSubject(claims: KeycloakAccessTokenClaims): string {
  return typeof claims.sub === 'string' ? claims.sub : '';
}

function listaDeTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : [];
}
