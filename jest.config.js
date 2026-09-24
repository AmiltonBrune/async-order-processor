/**
 * Um projeto por nivel da piramide (ver docs/TESTING.md secao 3).
 * A separacao existe para que `npm run test:fast` — arquitetura + unitarios —
 * rode sem Docker e sem esperar nenhum servico subir.
 */
/**
 * `*.spec.ts` NAO casa com `health.e2e-spec.ts` — o separador antes de `spec` e
 * hifen, nao ponto. O arquivo existia, estava documentado e simplesmente nunca
 * rodava: o pior tipo de teste, o que da a sensacao de cobertura sem cobrir.
 * Foi um teste de arquitetura que pegou isso, e ele agora vigia o padrao.
 */
const PADRAO_DE_TESTE = '**/*.{spec,e2e-spec}.ts';

const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};

module.exports = {
  projects: [
    { ...base, displayName: 'arch', testMatch: [`<rootDir>/test/architecture/${PADRAO_DE_TESTE}`] },
    { ...base, displayName: 'unit', testMatch: [`<rootDir>/test/unit/${PADRAO_DE_TESTE}`] },
    {
      ...base,
      displayName: 'bdd',
      testMatch: [`<rootDir>/test/bdd/${PADRAO_DE_TESTE}`],
      setupFilesAfterEnv: ['<rootDir>/test/support/setup.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: [`<rootDir>/test/integration/${PADRAO_DE_TESTE}`],
      setupFilesAfterEnv: ['<rootDir>/test/support/setup.ts'],
    },
    {
      ...base,
      displayName: 'concurrency',
      testMatch: [`<rootDir>/test/concurrency/${PADRAO_DE_TESTE}`],
      setupFilesAfterEnv: ['<rootDir>/test/support/setup.ts'],
    },
  ],
  // Os módulos ENTRAM na medição: eles são fiação, mas fiação errada é o que faz
  // um provedor não ser trocado ou um guard não ser registrado, e as suítes de
  // BDD e integração os exercitam de verdade ao subir a aplicação.
  //
  // Fica de fora apenas o que não é executável como código de aplicação:
  // migrations (SQL verificado por `schema-invariants.spec.ts` contra o banco
  // real) e o datasource do CLI, que só o `npm run migration:run` carrega.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/migrations/**',
    '!src/infrastructure/persistence/datasource/cli.datasource.ts',
  ],
  // 100% em statements, linhas e funções, exigido e verificado.
  //
  // Branches fica em 85 por uma razão estrutural, não por concessão: com
  // `emitDecoratorMetadata`, o TypeScript emite um ternário de guarda
  // (`typeof X !== "undefined" && X ? _a : Object`) para cada parâmetro
  // injetado cujo tipo é uma interface — e as portas deste projeto SÃO
  // interfaces. São 78 ramos que nenhum teste alcança, porque quem decide qual
  // lado executa é o carregador de módulos, não a entrada do teste.
  //
  // Medido em 2026-09-24: 548 ramos no total, 78 emitidos pelo compilador,
  // **470 de 470 ramos autorais cobertos**. O piso de 85 protege contra
  // regressão real; `test/architecture/coverage-policy.spec.ts` impede que
  // alguém baixe os 100% sem que o CI perceba.
  coverageThreshold: {
    global: { statements: 100, lines: 100, functions: 100, branches: 85 },
  },
};
