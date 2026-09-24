import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, assertNoViolations } from './arch-utils';

describe('arquitetura: política de cobertura', () => {
  const config = readFileSync(join(ROOT, 'jest.config.js'), 'utf8');

  it.each(['statements', 'lines', 'functions'])(
    'o limiar global de %s continua em 100',
    (metrica) => {
      const encontrado = new RegExp(`${metrica}:\\s*(\\d+)`).exec(config)?.[1];
      assertNoViolations(
        `${metrica} precisa ficar em 100 — abaixar esconde código não exercitado`,
        encontrado === '100' ? [] : [`jest.config.js declara ${metrica}: ${String(encontrado)}`],
      );
    },
  );

  it('o piso de branches não pode cair', () => {
    // 85 é o teto alcançável: os ramos restantes são metadata de decorator
    // emitida pelo TypeScript, e nenhum teste os alcança. Baixar daqui deixaria
    // de proteger ramo AUTORAL descoberto, que é o que importa.
    const piso = Number(/branches:\s*(\d+)/.exec(config)?.[1] ?? 0);
    assertNoViolations(
      'O piso de branches reflete o teto alcançável com emitDecoratorMetadata',
      piso >= 85 ? [] : [`jest.config.js declara branches: ${piso}, abaixo do piso de 85`],
    );
  });

  it('nada do código de aplicação é excluído da medição sem justificativa', () => {
    // Exclusão silenciosa é a outra forma de fabricar 100%: some com o arquivo
    // difícil e o número sobe sozinho.
    const exclusoes = [...config.matchAll(/'!src\/([^']+)'/g)]
      .map(([, caminho]) => caminho)
      .filter((caminho): caminho is string => caminho !== undefined);
    const permitidas = ['**/migrations/**', 'infrastructure/persistence/datasource/cli.datasource.ts'];
    const violations = exclusoes
      .filter((caminho) => !permitidas.includes(caminho))
      .map((caminho) => `src/${caminho} excluído da cobertura sem constar na lista justificada`);
    assertNoViolations('Toda exclusão de cobertura é uma decisão registrada', violations);
  });
});
