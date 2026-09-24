import { defineFeature, loadFeature } from 'jest-cucumber';

import { definirCenariosDeAutenticacao } from '../support/autenticacao.steps';
import { PROVEDOR_LOCAL } from '../support/provedor-de-identidade';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/autenticacao.feature');
const world = useWorld();

defineFeature(feature, (test) => {
  definirCenariosDeAutenticacao(test, world, PROVEDOR_LOCAL);
});
