const PROVEDOR_ORIGINAL = process.env['AUTH_PROVIDER'];
process.env['AUTH_PROVIDER'] = 'keycloak';
process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8082/realms/loja';
process.env['KEYCLOAK_CLIENT_ID'] = 'async-order-processor';
process.env['KEYCLOAK_CLIENT_SECRET'] = 'segredo-de-desenvolvimento-trocar-em-producao';

import { defineFeature, loadFeature } from 'jest-cucumber';

import { definirCenariosDeAutenticacao } from '../support/autenticacao.steps';
import { PROVEDOR_KEYCLOAK } from '../support/provedor-de-identidade';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/autenticacao.feature');
const world = useWorld();

afterAll(() => {
  if (PROVEDOR_ORIGINAL === undefined) delete process.env['AUTH_PROVIDER'];
  else process.env['AUTH_PROVIDER'] = PROVEDOR_ORIGINAL;
});

defineFeature(feature, (test) => {
  it('a aplicação está mesmo usando o adaptador de SSO', () => {
    expect(world().env.authProvider).toBe('keycloak');
  });

  definirCenariosDeAutenticacao(test, world, PROVEDOR_KEYCLOAK);
});
