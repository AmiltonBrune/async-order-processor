import {
  LAYERS,
  Layer,
  SourceFile,
  assertNoViolations,
  externalImports,
  internalImports,
  outsideImports,
  readSourceFiles,
  sobreOCodigoFonte,
} from './arch-utils';

const ALLOWED_LAYERS: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  shared: ['domain', 'shared'],
  application: ['domain', 'shared', 'application'],
  infrastructure: ['domain', 'shared', 'application', 'infrastructure'],
  interface: ['domain', 'shared', 'application', 'interface'],
  workers: ['domain', 'shared', 'application', 'infrastructure', 'workers'],
  main: [...LAYERS],
};

const ALLOWED_SLICES: Partial<Record<Layer, readonly string[]>> = {
  interface: ['infrastructure/config', 'infrastructure/observability'],
};

const DOMAIN_ALLOWED_PACKAGES: readonly string[] = ['decimal.js', 'uuid', 'node:crypto'];

const FRAMEWORK_E_DRIVERS: readonly string[] = [
  'typeorm',
  '@nestjs/typeorm',
  'amqplib',
  'mysql2',
  'express',
  '@nestjs/swagger',
  'class-validator',
  'pino',
];

const FORBIDDEN_PACKAGES: Record<Layer, readonly string[]> = {
  domain: [],
  shared: FRAMEWORK_E_DRIVERS,
  application: FRAMEWORK_E_DRIVERS,
  infrastructure: [],
  interface: ['typeorm', '@nestjs/typeorm', 'amqplib', 'mysql2'],
  workers: ['express', '@nestjs/swagger'],
  main: [],
};

const PACKAGE_OWNERS: Readonly<Record<string, string>> = {
  typeorm: 'infrastructure/persistence',
  '@nestjs/typeorm': 'infrastructure/persistence',
  mysql2: 'infrastructure/persistence',
  amqplib: 'infrastructure/messaging',
  pino: 'infrastructure/observability',
  'nestjs-pino': 'infrastructure/observability',
  'decimal.js': 'domain/shared',
};

const withoutExtension = (path: string): string => path.replace(/\.ts$/, '');

function indexByPath(files: readonly SourceFile[]): Map<string, SourceFile> {
  return new Map(files.map((file) => [withoutExtension(file.path), file]));
}

function resolveTarget(
  index: Map<string, SourceFile>,
  path: string,
): SourceFile | undefined {
  const key = withoutExtension(path);
  return index.get(key) ?? index.get(`${key}/index`);
}

sobreOCodigoFonte('arquitetura: fronteiras entre camadas', () => {
  it('existe código em src/ para analisar', () => {
    // O bloco inteiro só é ativado quando src/ existe, mas esta asserção
    // continua tendo trabalho: src/ pode existir e estar vazia, ou o leitor de
    // arquivos pode quebrar num refactor. Sem ela, todas as regras abaixo
    // passariam vazias — e regra de arquitetura que não lê arquivo nenhum
    // passa sempre.
    expect(readSourceFiles().length).toBeGreaterThan(0);
  });

  it.each(LAYERS)('a camada "%s" só importa camadas permitidas', (layer) => {
    const allowedLayers = ALLOWED_LAYERS[layer];
    const allowedSlices = ALLOWED_SLICES[layer] ?? [];
    const violations = readSourceFiles()
      .filter((file) => file.layer === layer)
      .flatMap((file) =>
        internalImports(file)
          .filter(
            (ref) =>
              !allowedLayers.includes(ref.layer) && !allowedSlices.includes(ref.slice),
          )
          .map((ref) => `${file.path} -> ${ref.path} (camada "${ref.layer}")`),
      );
    assertNoViolations(
      `"${layer}" só pode importar: ${[...allowedLayers, ...allowedSlices].join(', ')}`,
      violations,
    );
  });

  it('o domínio não conhece framework, ORM nem broker', () => {
    const violations = readSourceFiles()
      .filter((file) => file.layer === 'domain')
      .flatMap((file) =>
        externalImports(file)
          .filter((ref) => !DOMAIN_ALLOWED_PACKAGES.includes(ref.pkg))
          .map((ref) => `${file.path} importa "${ref.pkg}"`),
      );
    assertNoViolations(
      `O domínio só pode depender de: ${DOMAIN_ALLOWED_PACKAGES.join(', ')}`,
      violations,
    );
  });

  it.each(LAYERS)('a camada "%s" não importa pacote proibido para ela', (layer) => {
    const forbidden = FORBIDDEN_PACKAGES[layer];
    const violations = readSourceFiles()
      .filter((file) => file.layer === layer)
      .flatMap((file) =>
        externalImports(file)
          .filter((ref) => forbidden.includes(ref.pkg))
          .map((ref) => `${file.path} importa "${ref.pkg}"`),
      );
    assertNoViolations(`"${layer}" não pode importar: ${forbidden.join(', ')}`, violations);
  });

  it('cada pacote de infraestrutura só aparece na fatia dona dele', () => {
    const violations = readSourceFiles()
      .filter((file) => file.layer !== 'main')
      .flatMap((file) =>
        externalImports(file)
          .map((ref) => ({ ref, owner: PACKAGE_OWNERS[ref.pkg] }))
          .filter(
            (entry): entry is { ref: (typeof entry)['ref']; owner: string } =>
              entry.owner !== undefined && !file.path.startsWith(`${entry.owner}/`),
          )
          .map(({ ref, owner }) => `${file.path} importa "${ref.pkg}", que pertence a ${owner}/`),
      );
    assertNoViolations('Cada dependência de infraestrutura tem um dono único', violations);
  });

  it('o controller não alcança a fila, nem indiretamente — requisito RT3', () => {
    // A regra de camada acima já barra o import direto. Esta fecha o caminho
    // transitivo (controller -> helper -> publisher), que é como a regra
    // costuma ser furada sem ninguém perceber na revisão.
    const files = readSourceFiles();
    const index = indexByPath(files);

    const pathToMessaging = (start: SourceFile): string[] | null => {
      const seen = new Set<string>([withoutExtension(start.path)]);
      const stack: Array<{ file: SourceFile; trail: string[] }> = [
        { file: start, trail: [start.path] },
      ];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) break;
        for (const ref of internalImports(current.file)) {
          if (ref.slice === 'infrastructure/messaging') return [...current.trail, ref.path];
          const next = resolveTarget(index, ref.path);
          if (!next || seen.has(withoutExtension(next.path))) continue;
          seen.add(withoutExtension(next.path));
          stack.push({ file: next, trail: [...current.trail, next.path] });
        }
      }
      return null;
    };

    const violations = files
      .filter((file) => file.layer === 'interface')
      .map((file) => pathToMessaging(file))
      .filter((trail): trail is string[] => trail !== null)
      .map((trail) => trail.join(' -> '));
    assertNoViolations(
      'A criação do pedido se desacopla do processamento pela outbox, não por chamada direta',
      violations,
    );
  });

  it('nenhum arquivo de src/ importa por caminho relativo algo de fora de src/', () => {
    const violations = readSourceFiles().flatMap((file) =>
      outsideImports(file).map((ref) => `${file.path} importa "${ref.spec}"`),
    );
    assertNoViolations('src/ não alcança test/ nem a raiz do projeto', violations);
  });

  it('não há ciclo de importação entre arquivos', () => {
    const files = readSourceFiles();
    const index = indexByPath(files);
    const state = new Map<string, 'visitando' | 'pronto'>();
    const cycles = new Set<string>();

    const visit = (file: SourceFile, trail: readonly string[]): void => {
      const key = withoutExtension(file.path);
      if (state.get(key) === 'pronto') return;
      if (state.get(key) === 'visitando') {
        const from = trail.indexOf(file.path);
        cycles.add([...trail.slice(from === -1 ? 0 : from), file.path].join(' -> '));
        return;
      }
      state.set(key, 'visitando');
      for (const ref of internalImports(file)) {
        const next = resolveTarget(index, ref.path);
        if (next) visit(next, [...trail, file.path]);
      }
      state.set(key, 'pronto');
    };

    for (const file of files) visit(file, []);
    assertNoViolations('Ciclo de importação impede testar uma peça isolada', [...cycles]);
  });
});
