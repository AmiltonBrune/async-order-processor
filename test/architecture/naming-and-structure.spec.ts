import {
  assertNoViolations,
  internalImports,
  readSourceFiles,
  sobreOCodigoFonte,
} from './arch-utils';

const ALLOWED_SUFFIXES: ReadonlyArray<readonly [prefix: string, suffixes: readonly string[]]> = [
  [
    'domain/ports',
    ['.port.ts', 'index.ts'],
  ],
  [
    'domain',
    [
      '.entity.ts',
      '.vo.ts',
      '.enum.ts',
      '.event.ts',
      '.calculator.ts',
      '-policy.ts',
      '.error.ts',
      '.guard.ts',
      'index.ts',
    ],
  ],
  [
    'shared',
    ['.transformer.ts', '.port.ts', '.constants.ts', 'index.ts'],
  ],
  [
    'application',
    [
      '.use-case.ts',
      '.command.ts',
      '.query.ts',
      '.result.ts',
      '.constants.ts',
      '.module.ts',
      'index.ts',
    ],
  ],
  [
    'infrastructure/persistence/migrations',
    ['.ts'],
  ],
  [
    'infrastructure/persistence',
    [
      '.repository.ts',
      '.entity-schema.ts',
      'entities.ts',
      '.datasource.ts',
      '.unit-of-work.ts',
      '.errors.ts',
      '.probe.ts',
      '.constants.ts',
      '.module.ts',
      'index.ts',
    ],
  ],
  [
    'infrastructure/messaging',
    [
      '.publisher.ts',
      '.consumer.ts',
      '.topology.ts',
      '.codec.ts',
      '.connection.ts',
      '.probe.ts',
      '.constants.ts',
      '.module.ts',
      'index.ts',
    ],
  ],
  [
    'infrastructure/observability',
    ['.logger.ts', '.interceptor.ts', '.context.ts', '.constants.ts', '.module.ts', 'index.ts'],
  ],
  [
    'infrastructure/config',
    ['.config.ts', '.schema.ts', '.constants.ts', '.module.ts', 'index.ts'],
  ],
  [
    'infrastructure/security',
    [
      '.hasher.ts',
      '.issuer.ts',
      '.verifier.ts',
      '.authenticator.ts',
      '.mapper.ts',
      '.cache.ts',
      '.constants.ts',
      '.module.ts',
      'index.ts',
    ],
  ],
  [
    'interface/http',
    [
      '.controller.ts',
      '.dto.ts',
      '.presenter.ts',
      '.filter.ts',
      '.guard.ts',
      '.decorator.ts',
      '.interceptor.ts',
      '.pipe.ts',
      '.setup.ts',
      '.api-docs.ts',
      '.constants.ts',
      '.module.ts',
      'index.ts',
    ],
  ],
  [
    'workers',
    ['.worker.ts', '.runner.ts', '.module.ts', 'index.ts'],
  ],
];

const REQUIRED_FILES: readonly string[] = [
  'main.ts',
  'app.module.ts',
  'domain/order/order.entity.ts',
  'domain/order/order-status.enum.ts',
  'domain/order/order-total.calculator.ts',
  'domain/order/events/order-created.event.ts',
  'domain/product/product.entity.ts',
  'domain/stock/stock-reservation.entity.ts',
  'domain/shared/money.vo.ts',
  'domain/shared/errors/index.ts',
  'domain/shared/errors/domain.error.ts',
  'domain/shared/errors/failure-code.enum.ts',
  'shared/transformers/money.transformer.ts',
  'domain/shared/retry-policy.ts',
];

const REQUIRED_DIRECTORIES: readonly string[] = [
  'domain/ports',
  'application/create-order',
  'application/process-order',
  'application/reprocess-order',
  'application/get-order',
  'application/list-orders',
  'domain/shared/errors',
  'domain/ports/repositories',
  'domain/ports/system',
  'shared/transformers',
  'infrastructure/persistence/order',
  'infrastructure/persistence/product',
  'infrastructure/persistence/stock',
  'infrastructure/persistence/outbox',
  'infrastructure/persistence/inbox',
  'infrastructure/persistence/user',
  'infrastructure/persistence/errors',
  'infrastructure/persistence/datasource',
  'infrastructure/persistence/unit-of-work',
  'infrastructure/persistence/health',
  'infrastructure/messaging',
  'infrastructure/observability',
  'infrastructure/config',
  'interface/http/orders',
  'interface/http/orders/dto',
  'interface/http/auth',
  'interface/http/health',
  'interface/http/common/guards',
  'interface/http/common/decorators',
  'interface/http/common/filters',
  'interface/http/common/dto',
  'interface/http/docs',
  'infrastructure/security/tokens',
  'infrastructure/security/keycloak',
  'infrastructure/messaging/amqp',
  'infrastructure/messaging/orders',
  'workers/relay',
  'workers/consumer',
];

const KEBAB_CASE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*\.ts$/;

const ROOT_COMPOSITION = /^(main\.ts|[a-z0-9-]+\.module\.ts)$/;

sobreOCodigoFonte('arquitetura: nomes e estrutura', () => {
  it('todo arquivo de produção tem nome em kebab-case', () => {
    const violations = readSourceFiles()
      .map((file) => file.path)
      .filter((path) => {
        const name = path.split('/').pop() ?? '';
        return !KEBAB_CASE.test(name);
      });
    assertNoViolations('Nome de arquivo em kebab-case, sempre', violations);
  });

  it('todo arquivo usa um sufixo previsto para a fatia onde mora', () => {
    const violations = readSourceFiles()
      .filter((file) => !ROOT_COMPOSITION.test(file.path))
      .filter((file) => {
        const rule = ALLOWED_SUFFIXES.find(([prefix]) => file.path.startsWith(`${prefix}/`));
        if (!rule) return true;
        const [, suffixes] = rule;
        return !suffixes.some((suffix) => file.path.endsWith(suffix));
      })
      .map((file) => `${file.path} — sufixo não previsto para a fatia "${file.slice}"`);
    assertNoViolations(
      'Sufixo do arquivo declara o papel dele (ver ALLOWED_SUFFIXES neste arquivo)',
      violations,
    );
  });

  it('os arquivos prometidos pela seção 2.4 existem', () => {
    const existing = new Set(readSourceFiles().map((file) => file.path));
    const missing = REQUIRED_FILES.filter((path) => !existing.has(path)).map(
      (path) => `src/${path} não existe`,
    );
    assertNoViolations('ARCHITECTURE.md §2.4 promete estes arquivos', missing);
  });

  it('as pastas prometidas pela seção 2.4 existem e têm conteúdo', () => {
    const paths = readSourceFiles().map((file) => file.path);
    const missing = REQUIRED_DIRECTORIES.filter(
      (dir) => !paths.some((path) => path.startsWith(`${dir}/`)),
    ).map((dir) => `src/${dir}/ está ausente ou vazia`);
    assertNoViolations('ARCHITECTURE.md §2.4 promete estas fatias', missing);
  });

  it('cada caso de uso mora na própria pasta, com um único .use-case.ts', () => {
    const useCases = readSourceFiles().filter(
      (file) => file.layer === 'application' && file.path.endsWith('.use-case.ts'),
    );
    const bySlice = new Map<string, string[]>();
    for (const file of useCases) {
      bySlice.set(file.slice, [...(bySlice.get(file.slice) ?? []), file.path]);
    }
    const violations = [...bySlice.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([slice, files]) => `${slice} tem ${files.length} casos de uso: ${files.join(', ')}`);
    assertNoViolations('Um caso de uso por pasta — pasta é a unidade de leitura', violations);
  });

  // A raiz de uma fatia é para composição: módulo, constantes e índices. Quem
  // adapta alguma coisa — repositório, controller, guard, DTO — mora na pasta do
  // que ele adapta. Foi assim que `persistence/` e `interface/http/` viraram
  // baldes de 15 arquivos antes desta regra existir.
  const RAIZ_DE_FATIA: readonly string[] = [
    'infrastructure/persistence',
    'infrastructure/messaging',
    'infrastructure/security',
    'interface/http',
  ];

  it.each(RAIZ_DE_FATIA)('a raiz de %s só guarda composição, não adaptador', (fatia) => {
    const profundidadeDaRaiz = `${fatia}/`.split('/').length;
    const violations = readSourceFiles()
      .filter((file) => file.path.startsWith(`${fatia}/`))
      .filter((file) => file.path.split('/').length === profundidadeDaRaiz)
      .filter((file) => !/(\.module|\.constants|entities)\.ts$/.test(file.path))
      .map((file) => `${file.path} está solto na raiz de ${fatia}/`);
    assertNoViolations(
      'Adaptador mora na pasta do que ele adapta — a raiz fica com módulo, constantes e índices',
      violations,
    );
  });

  it('nenhum arquivo declara um DTO de outro recurso', () => {
    const violations = readSourceFiles()
      .filter((file) => file.path.endsWith('.dto.ts'))
      .flatMap((file) => {
        const declaradas = [...file.text.matchAll(/export class (\w+)/g)].map(([, nome]) => nome);
        return declaradas.length > 1
          ? [`${file.path} declara ${declaradas.length} DTOs: ${declaradas.join(', ')}`]
          : [];
      });
    assertNoViolations(
      'Um DTO por arquivo — foi um arquivo com nove que misturou pedido, login e health check',
      violations,
    );
  });

  it('cada repositório mora na própria pasta, junto do schema que ele mapeia', () => {
    const repositorios = readSourceFiles().filter(
      (file) =>
        file.slice === 'infrastructure/persistence' && file.path.endsWith('.repository.ts'),
    );
    const porPasta = new Map<string, string[]>();
    for (const file of repositorios) {
      const pasta = file.path.slice(0, file.path.lastIndexOf('/'));
      porPasta.set(pasta, [...(porPasta.get(pasta) ?? []), file.path]);
    }
    const violations = [...porPasta.keys()]
      .filter((pasta) => pasta === 'infrastructure/persistence')
      .map(() => 'há repositório direto em infrastructure/persistence/, sem pasta própria');
    assertNoViolations('Um agregado, uma pasta — repositório e EntitySchema lado a lado', violations);
  });

  it('o schema de persistência não vaza para fora da pasta do agregado dele', () => {
    const schemas = readSourceFiles().filter((file) => file.path.endsWith('.entity-schema.ts'));
    const pastaDe = (path: string): string => path.slice(0, path.lastIndexOf('/'));
    const donos = new Map(schemas.map((file) => [file.path.replace(/\.ts$/, ''), pastaDe(file.path)]));
    const violations = readSourceFiles()
      .filter((file) => !file.path.endsWith('entities.ts'))
      .flatMap((file) =>
        internalImports(file)
          .map((ref) => ({ ref, dono: donos.get(ref.path.replace(/\.ts$/, '')) }))
          .filter(({ dono }) => dono !== undefined && dono !== pastaDe(file.path))
          .map(({ ref }) => `${file.path} importa ${ref.path}, de outra pasta`),
      );
    assertNoViolations(
      'O mapeamento de tabela é detalhe da pasta do agregado — fora dela se fala com o repositório',
      violations,
    );
  });

  it('as portas do domínio declaram só contrato, sem implementação', () => {
    const violations = readSourceFiles()
      .filter((file) => file.slice === 'domain/ports')
      .filter((file) => /\bclass\s+\w/.test(file.text) && !/\babstract\s+class\b/.test(file.text))
      .map((file) => `${file.path} declara uma classe concreta`);
    assertNoViolations(
      'Porta é interface ou classe abstrata — implementação mora em infrastructure/',
      violations,
    );
  });
});
