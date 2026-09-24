import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import micromatch from 'micromatch';

import {
  ROOT,
  assertNoViolations,
  readFeatureFiles,
  readSourceFiles,
  readTestFiles,
  sobreOCodigoFonte,
} from './arch-utils';

const SEM_COMPORTAMENTO = /(\.constants\.ts|\.enum\.ts|\.module\.ts|\.port\.ts|index\.ts|\.command\.ts|\.query\.ts|\.result\.ts)$/;

const REQUISITOS_COM_BDD: readonly string[] = [
  '@rf1', '@rf2', '@rf3', '@rf4', '@rf5',
  '@rn1', '@rn2', '@rn3', '@rn4',
  '@b1', '@b2', '@b5',
];

const baseName = (path: string): string => path.split('/').pop() ?? path;

sobreOCodigoFonte('arquitetura: cobertura por estrutura', () => {
  it('todo arquivo de domínio e de aplicação com comportamento tem um .spec.ts', () => {
    const specs = new Set(readTestFiles().map((file) => file.name));
    const violations = readSourceFiles()
      .filter((file) => file.layer === 'domain' || file.layer === 'application')
      .filter((file) => !file.path.startsWith('domain/ports/'))
      .filter((file) => !SEM_COMPORTAMENTO.test(file.path))
      .filter((file) => !specs.has(baseName(file.path).replace(/\.ts$/, '.spec.ts')))
      .map((file) => `${file.path} não tem ${baseName(file.path).replace(/\.ts$/, '.spec.ts')}`);
    assertNoViolations(
      'Regra de negócio sem teste unitário é regra que ninguém pode refatorar com segurança',
      violations,
    );
  });
});

/**
 * Daqui para baixo, nada depende de `src/`: a especificação escrita
 * (histórias -> `.feature` -> matriz do `TESTING.md`) é verificável desde a fase
 * F-1, e é justamente nessa fase que ela precisa estar coerente.
 */
describe('arquitetura: integridade da especificação', () => {
  it('existe pelo menos um .feature descrevendo o comportamento esperado', () => {
    expect(readFeatureFiles().length).toBeGreaterThan(0);
  });

  it('todo .feature declara o idioma e tem cenário', () => {
    const violations = readFeatureFiles().flatMap((file) => {
      const problemas: string[] = [];
      if (!file.text.startsWith('# language: pt')) {
        problemas.push(`${file.path} não começa com "# language: pt"`);
      }
      if (!/^\s*(Cenário|Esquema do Cenário):/m.test(file.text)) {
        problemas.push(`${file.path} não tem nenhum cenário`);
      }
      if (!/@us-\d+/.test(file.text)) {
        problemas.push(`${file.path} não aponta para nenhuma user story (@us-N)`);
      }
      return problemas;
    });
    assertNoViolations('Todo .feature é rastreável até uma user story', violations);
  });

  it('todo requisito do enunciado tem pelo menos um cenário BDD', () => {
    const tags = readFeatureFiles()
      .flatMap((file) => file.text.match(/@[\w-]+/g) ?? [])
      .map((tag) => tag.toLowerCase());
    const violations = REQUISITOS_COM_BDD.filter((req) => !tags.includes(req)).map(
      (req) => `nenhum cenário marcado com ${req}`,
    );
    assertNoViolations(
      'Rastreabilidade enunciado -> BDD (ver ARCHITECTURE.md §3 e USER_STORIES.md)',
      violations,
    );
  });

  it('todo teste citado na matriz do TESTING.md existe em disco', () => {
    // A matriz é escrita antes do código (TDD). Uma linha marcada com ⏳ é
    // backlog declarado: ainda não escrita, e esta asserção a ignora. Tirar o
    // ⏳ é exatamente o passo "agora eu escrevi" — e a partir daí o arquivo
    // precisa existir de verdade.
    const doc = join(ROOT, 'docs', 'TESTING.md');
    expect(existsSync(doc)).toBe(true);
    const entregues = readFileSync(doc, 'utf8')
      .split('\n')
      .filter((linha) => !linha.includes('⏳'))
      .join('\n');
    const citados = [
      ...new Set(
        (entregues.match(/`[\w.-]+\.(?:e2e-)?spec\.ts`/g) ?? []).map((token) =>
          token.replace(/`/g, ''),
        ),
      ),
    ];
    const existentes = new Set(readTestFiles().map((file) => file.name));
    const violations = citados
      .filter((nome) => !existentes.has(nome))
      .map((nome) => `${nome} está na matriz do TESTING.md mas não existe`);
    assertNoViolations(
      'Linha sem ⏳ na matriz é promessa de que o arquivo existe',
      violations,
    );
  });

  it('todo arquivo de teste é alcançado por algum projeto do Jest', () => {
    // A regra que faltava. `health.e2e-spec.ts` existia, estava documentado e
    // nunca rodava, porque `*.spec.ts` não casa com um nome cujo separador antes
    // de `spec` é hífen. Um teste que o runner não enxerga é pior que teste
    // ausente: ele conta na revisão e não conta no CI.
    // O `testMatch` vive num .js sem tipos; ler o texto e extrair os padroes
    // evita tanto um `require` sem tipo quanto um .d.ts só para isto.
    const jestConfig = readFileSync(join(ROOT, 'jest.config.js'), 'utf8');
    const padrao = jestConfig.match(/PADRAO_DE_TESTE = '([^']+)'/)?.[1];
    expect(padrao).toBeDefined();
    const projetos = [...jestConfig.matchAll(/testMatch: \[`<rootDir>\/([^$]+)\$\{PADRAO_DE_TESTE\}`\]/g)];
    const padroes = projetos.map(([, prefixo]) => `${prefixo}${padrao}`);
    expect(padroes.length).toBeGreaterThan(0);

    const violations = readTestFiles()
      .map((file) => relative(ROOT, join(ROOT, file.path)))
      .filter((caminho) => !micromatch.isMatch(caminho, padroes))
      .map((caminho) => `${caminho} não casa com nenhum testMatch: ${padroes.join(' | ')}`);
    assertNoViolations('Teste invisível para o runner é teste que não existe', violations);
  });

  it('todo teste em disco está citado na matriz do TESTING.md', () => {
    // O inverso do anterior: teste que ninguém documentou costuma ser teste que
    // ninguém sabe por que existe — e o primeiro a ser deletado quando fica
    // vermelho por um motivo legítimo.
    const doc = readFileSync(join(ROOT, 'docs', 'TESTING.md'), 'utf8');
    const violations = readTestFiles()
      .filter((file) => !file.path.startsWith('test/architecture/'))
      .filter((file) => !doc.includes(file.name))
      .map((file) => `${file.path} não aparece na matriz do TESTING.md`);
    assertNoViolations('Todo teste tem um porquê escrito', violations);
  });
});
