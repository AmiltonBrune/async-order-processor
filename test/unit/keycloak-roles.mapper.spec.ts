import {
  extrairSubject,
  mapearPapeis,
} from '../../src/infrastructure/security/keycloak/keycloak-roles.mapper';

const CONHECIDOS = ['ADMIN', 'CUSTOMER'];

describe('mapearPapeis (Keycloak → papéis internos)', () => {
  it('traz os papéis de realm que este sistema conhece', () => {
    expect(
      mapearPapeis({ realm_access: { roles: ['CUSTOMER', 'ADMIN'] } }, CONHECIDOS),
    ).toEqual(['ADMIN', 'CUSTOMER']);
  });

  it('DESCARTA os papéis internos do Keycloak', () => {
    const papeis = mapearPapeis(
      {
        realm_access: {
          roles: ['offline_access', 'uma_authorization', 'default-roles-loja', 'CUSTOMER'],
        },
      },
      CONHECIDOS,
    );
    expect(papeis).toEqual(['CUSTOMER']);
  });

  it('um papel novo criado no console não vira privilégio sozinho', () => {
    expect(mapearPapeis({ realm_access: { roles: ['SUPERADMIN'] } }, CONHECIDOS)).toEqual([]);
  });

  it('lê também os papéis do client, não só os de realm', () => {
    expect(
      mapearPapeis(
        { resource_access: { 'async-order-processor': { roles: ['ADMIN'] } } },
        CONHECIDOS,
        'async-order-processor',
      ),
    ).toEqual(['ADMIN']);
  });

  it('ignora papéis de OUTRO client', () => {
    expect(
      mapearPapeis(
        { resource_access: { 'outro-sistema': { roles: ['ADMIN'] } } },
        CONHECIDOS,
        'async-order-processor',
      ),
    ).toEqual([]);
  });

  it('compara sem diferenciar maiúsculas', () => {
    expect(mapearPapeis({ realm_access: { roles: ['admin'] } }, CONHECIDOS)).toEqual(['ADMIN']);
  });

  it.each([
    ['sem realm_access', {}],
    ['com roles nulo', { realm_access: { roles: null } }],
    ['com roles não-lista', { realm_access: { roles: 'ADMIN' } }],
    ['com itens não textuais', { realm_access: { roles: [1, true, null] } }],
  ])('sobrevive a payload %s devolvendo lista vazia', (_caso, claims) => {
    expect(mapearPapeis(claims, CONHECIDOS)).toEqual([]);
  });

  it('não duplica papel que vem do realm e do client', () => {
    expect(
      mapearPapeis(
        {
          realm_access: { roles: ['ADMIN'] },
          resource_access: { app: { roles: ['ADMIN'] } },
        },
        CONHECIDOS,
        'app',
      ),
    ).toEqual(['ADMIN']);
  });
});

describe('extrairSubject', () => {
  it('devolve o sub quando é texto', () => {
    expect(extrairSubject({ sub: 'f:loja:123' })).toBe('f:loja:123');
  });

  it('devolve vazio quando o sub falta ou não é texto', () => {
    expect(extrairSubject({})).toBe('');
    expect(extrairSubject({ sub: 42 })).toBe('');
  });
});
