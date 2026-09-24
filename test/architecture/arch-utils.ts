import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '..', '..');
export const SRC = join(ROOT, 'src');

export type Layer =
  | 'domain'
  | 'shared'
  | 'application'
  | 'infrastructure'
  | 'interface'
  | 'workers'
  | 'main';

export const LAYERS: readonly Layer[] = [
  'domain',
  'shared',
  'application',
  'infrastructure',
  'interface',
  'workers',
  'main',
] as const;

export type ImportRef =
  | { kind: 'internal'; spec: string; path: string; layer: Layer; slice: string }
  | { kind: 'external'; spec: string; pkg: string }
  | { kind: 'outside'; spec: string; resolved: string };

export interface SourceFile {
  path: string;
  layer: Layer;
  slice: string;
  text: string;
  imports: ImportRef[];
}

const TS_FILE = /\.ts$/;
const IGNORED = /\.(spec|e2e-spec|d)\.ts$/;

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (TS_FILE.test(entry) && !IGNORED.test(entry)) acc.push(full);
  }
  return acc;
}

export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
];

function parseSpecifiers(text: string): string[] {
  const clean = stripComments(text);
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(clean)) !== null) {
      const [, spec] = match;
      if (spec) found.add(spec);
    }
  }
  return [...found];
}

export function classify(relPath: string): { layer: Layer; slice: string } {
  const segments = relPath.split('/');
  const [head = '', second = ''] = segments;
  if (segments.length === 1) return { layer: 'main', slice: 'main' };
  const layer = LAYERS.find((candidate) => candidate === head);
  if (!layer) {
    throw new Error(
      `Pasta de topo não prevista na arquitetura: src/${head}/. ` +
        `Permitidas: ${LAYERS.filter((l) => l !== 'main').join(', ')} (ver ARCHITECTURE.md §2.4).`,
    );
  }
  return { layer, slice: second ? `${head}/${second}` : head };
}

function packageOf(spec: string): string {
  if (spec.startsWith('node:')) return spec;
  const parts = spec.split('/');
  const [first = '', second = ''] = parts;
  return first.startsWith('@') ? `${first}/${second}` : first;
}

function resolveRef(fromRel: string, spec: string): ImportRef {
  const isRelative = spec.startsWith('.');
  const isSrcAbsolute = spec.startsWith('src/') || spec.startsWith('@/');
  if (!isRelative && !isSrcAbsolute) {
    return { kind: 'external', spec, pkg: packageOf(spec) };
  }
  const target = isRelative
    ? resolve(SRC, dirname(fromRel), spec)
    : resolve(SRC, spec.replace(/^(src\/|@\/)/, ''));
  const rel = relative(SRC, target).split('\\').join('/');
  if (rel.startsWith('..')) return { kind: 'outside', spec, resolved: rel };
  const { layer, slice } = classify(rel);
  return { kind: 'internal', spec, path: rel, layer, slice };
}

let cache: SourceFile[] | null = null;

/** Todos os `.ts` de produção sob `src/`. Vazio enquanto a fase F0 não rodou. */
export function readSourceFiles(): SourceFile[] {
  if (cache) return cache;
  cache = walk(SRC).map((absolute) => {
    const path = relative(SRC, absolute).split('\\').join('/');
    const text = readFileSync(absolute, 'utf8');
    const { layer, slice } = classify(path);
    return { path, layer, slice, text, imports: parseSpecifiers(text).map((s) => resolveRef(path, s)) };
  });
  return cache;
}

export interface PlainFile {
  /** caminho relativo à raiz do repositório */
  path: string;
  /** nome do arquivo, sem diretório */
  name: string;
  text: string;
}

function collect(dir: string, matches: RegExp): PlainFile[] {
  if (!existsSync(dir)) return [];
  const found: PlainFile[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (matches.test(entry)) {
        found.push({
          path: relative(ROOT, full).split('\\').join('/'),
          name: entry,
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  }
  return found;
}

/** Todo arquivo de teste do repositório — usado para exigir cobertura por estrutura. */
export function readTestFiles(): PlainFile[] {
  return [
    ...collect(join(ROOT, 'test'), /\.(spec|e2e-spec)\.ts$/),
    ...collect(SRC, /\.(spec|e2e-spec)\.ts$/),
  ];
}

/** Todo `.feature` do repositório — a especificação BDD é parte da arquitetura. */
export function readFeatureFiles(): PlainFile[] {
  return collect(join(ROOT, 'features'), /\.feature$/);
}

export function filesOfLayer(layer: Layer): SourceFile[] {
  return readSourceFiles().filter((file) => file.layer === layer);
}

type InternalRef = Extract<ImportRef, { kind: 'internal' }>;
type ExternalRef = Extract<ImportRef, { kind: 'external' }>;
type OutsideRef = Extract<ImportRef, { kind: 'outside' }>;

export function internalImports(file: SourceFile): InternalRef[] {
  return file.imports.filter((ref): ref is InternalRef => ref.kind === 'internal');
}

export function externalImports(file: SourceFile): ExternalRef[] {
  return file.imports.filter((ref): ref is ExternalRef => ref.kind === 'external');
}

export function outsideImports(file: SourceFile): OutsideRef[] {
  return file.imports.filter((ref): ref is OutsideRef => ref.kind === 'outside');
}

/**
 * Existe código em `src/`? Antes da fase F0 do `PLAN.md` não existe: o projeto
 * está na fase de especificação, com arquitetura, histórias e Gherkin escritos.
 */
export function existeCodigoFonte(): boolean {
  return existsSync(SRC);
}

/**
 * Bloco de asserções que só tem sentido sobre código que existe.
 *
 * Enquanto `src/` não existir, o bloco fica **inativo e visível** na saída do
 * Jest, em vez de passar vazio. A diferença importa: uma regra de fronteira
 * avaliada sobre zero arquivo devolve zero violações e fica verde — verde que
 * não prova nada e que some no meio da suíte. Marcado como inativo, ele diz a
 * verdade sobre a fase em que o projeto está.
 *
 * Não há nada para religar depois: assim que a F0 criar `src/`, o bloco volta a
 * valer sozinho, e as mesmas asserções passam a poder falhar.
 */
export function sobreOCodigoFonte(titulo: string, corpo: () => void): void {
  if (existeCodigoFonte()) {
    describe(titulo, corpo);
    return;
  }
  describe.skip(`${titulo} [inativo: src/ ainda não existe — fase F0 do PLAN.md]`, corpo);
}

/**
 * Falha apontando o arquivo culpado, não só o total.
 * Um teste de arquitetura que diz "3 violações" e não diz quais custa mais
 * tempo do que economiza.
 */
export function assertNoViolations(rule: string, violations: readonly string[]): void {
  if (violations.length === 0) return;
  throw new Error(
    `\n${rule}\n${violations.length} violação(ões):\n  - ${violations.join('\n  - ')}\n`,
  );
}
