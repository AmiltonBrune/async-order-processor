/**
 * A política de camadas do ADR-012, verificada em tempo de lint.
 *
 * A suíte `test/architecture/` cobre o mesmo terreno e mais um pouco (caminho
 * transitivo, ciclos, arquivo ausente). As duas coexistem de propósito: o lint
 * dá o retorno dentro do editor, enquanto o teste dá a mensagem completa e roda
 * no CI. Quem escreve o import errado descobre antes de salvar.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: 'tsconfig.json', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'boundaries'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, jest: true },
  ignorePatterns: ['dist/', 'node_modules/', '.eslintrc.js', 'jest.config.js'],
  settings: {
    // Sem o resolver de TypeScript, o plugin nao consegue transformar
    // `../../domain/shared/money.vo` num arquivo real, e classifica tudo como
    // desconhecido.
    'import/resolver': { typescript: { project: 'tsconfig.json' } },
    'boundaries/include': ['src/**/*.ts'],
    // `mode: 'file'` em todos: por padrão o plugin casa o padrão contra a PASTA
    // do arquivo, e aí `src/infrastructure/messaging/**/*` não classifica um
    // arquivo que mora direto em `messaging/`.
    'boundaries/elements': [
      { type: 'domain', pattern: 'src/domain/**/*.ts', mode: 'file' },
      { type: 'shared', pattern: 'src/shared/**/*.ts', mode: 'file' },
      { type: 'application', pattern: 'src/application/**/*.ts', mode: 'file' },
      { type: 'persistence', pattern: 'src/infrastructure/persistence/**/*.ts', mode: 'file' },
      { type: 'messaging', pattern: 'src/infrastructure/messaging/**/*.ts', mode: 'file' },
      { type: 'observability', pattern: 'src/infrastructure/observability/**/*.ts', mode: 'file' },
      { type: 'config', pattern: 'src/infrastructure/config/**/*.ts', mode: 'file' },
      { type: 'security', pattern: 'src/infrastructure/security/**/*.ts', mode: 'file' },
      { type: 'interface', pattern: 'src/interface/**/*.ts', mode: 'file' },
      { type: 'workers', pattern: 'src/workers/**/*.ts', mode: 'file' },
      { type: 'composition-root', pattern: 'src/*.ts', mode: 'file' },
    ],
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    // Prefixo `_` marca descarte intencional — desestruturar para remover uma
    // chave e parâmetro de callback que existe só para posicionar o seguinte.
    // Sem isto, a alternativa é `void x;` espalhado, que é pior de ler.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/explicit-member-accessibility': 'off',
    'no-console': 'error',
    'boundaries/no-unknown': 'error',
    'boundaries/no-unknown-files': 'error',
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          // O domínio não conhece ninguém. É o núcleo, e é por isso que ele é
          // testável em milissegundos, sem Docker.
          { from: 'domain', allow: ['domain'] },
          // A camada compartilhada converte tipos do domínio para a borda e
          // volta. Conhece o domínio; nenhuma tecnologia.
          { from: 'shared', allow: ['domain', 'shared'] },
          // A aplicação orquestra o domínio pelas portas. Não conhece banco,
          // fila nem HTTP.
          { from: 'application', allow: ['domain', 'shared', 'application'] },
          // Infraestrutura implementa as portas: pode olhar para dentro.
          {
            from: ['persistence', 'messaging', 'observability', 'config', 'security'],
            allow: [
              'domain',
              'shared',
              'application',
              'persistence',
              'messaging',
              'observability',
              'config',
              'security',
            ],
          },
          // O requisito RT3 do enunciado, como regra de lint: o controller pode
          // ver configuração e log, e NÃO pode ver persistência nem mensageria.
          {
            from: 'interface',
            allow: ['domain', 'shared', 'application', 'interface', 'config', 'observability'],
          },
          // Os workers são adaptadores de entrada: conhecem infraestrutura, mas
          // nunca a camada HTTP.
          {
            from: 'workers',
            allow: [
              'domain',
              'shared',
              'application',
              'persistence',
              'messaging',
              'observability',
              'config',
              'security',
              'workers',
            ],
          },
          // O composition root é o único que enxerga tudo ao mesmo tempo.
          { from: 'composition-root', allow: ['*'] },
        ],
      },
    ],
    'boundaries/external': [
      'error',
      {
        default: 'allow',
        rules: [
          {
            from: 'domain',
            disallow: ['@nestjs/*', 'typeorm', 'amqplib', 'mysql2', 'pino', 'express', 'class-validator'],
            message: 'O domínio não pode conhecer ${dependency} — só decimal.js, uuid e node:*.',
          },
          {
            from: 'shared',
            disallow: ['@nestjs/*', 'typeorm', 'amqplib', 'mysql2', 'pino', 'express', 'class-validator'],
            message:
              'A camada compartilhada é conversão pura — ${dependency} a prenderia a uma tecnologia.',
          },
          {
            from: 'application',
            disallow: ['typeorm', 'amqplib', 'mysql2', 'pino', 'express', '@nestjs/swagger'],
            message: 'A aplicação fala com o mundo por portas, nunca com ${dependency} direto.',
          },
          {
            from: 'interface',
            disallow: ['typeorm', 'amqplib', 'mysql2'],
            message: 'O controller não alcança ${dependency} — é o requisito RT3 do enunciado.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/infrastructure/persistence/migrations/*.ts'],
      // Migration é SQL com carimbo de data: nome de classe com timestamp e
      // string longa são a forma correta aqui.
      rules: { '@typescript-eslint/naming-convention': 'off' },
    },
  ],
};
