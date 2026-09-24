import {
  assertNoViolations,
  readSourceFiles,
  readTestFiles,
  sobreOCodigoFonte,
  stripComments,
} from './arch-utils';

interface Rule {
  readonly nome: string;
  readonly padrao: RegExp;
  readonly permitidoEm?: readonly string[];
  /**
   * Por padrao a regra olha so o codigo: um comentario que EXPLICA o SQL da
   * camada de persistencia nao e SQL fora do lugar, e falhar nele ensinaria o
   * time a nao comentar. A excecao e `@ts-ignore`, que so existe como comentario.
   */
  readonly incluiComentarios?: boolean;
  readonly porque: string;
}

const RULES: readonly Rule[] = [
  {
    nome: 'console.*',
    padrao: /\bconsole\.(log|info|warn|error|debug)\s*\(/,
    porque:
      'Log é estruturado e passa pelo Pino com correlationId (ADR sobre observabilidade). ' +
      'console.log não carrega contexto e não é filtrável no agregador.',
  },
  {
    nome: 'process.env fora de infrastructure/config',
    padrao: /\bprocess\.env\b/,
    permitidoEm: ['infrastructure/config/'],
    porque:
      'O ambiente é validado num único lugar, na subida. Ler env espalhado faz o ' +
      'processo subir e só quebrar na primeira requisição que usa a variável.',
  },
  {
    nome: 'synchronize: true',
    padrao: /synchronize\s*:\s*true/,
    porque: 'ADR-008: schema só muda por migration versionada, em qualquer ambiente.',
  },
  {
    nome: 'SQL cru num repositório',
    padrao: /\.query\s*\(\s*[`'"]/,
    permitidoEm: [
      // Migration: lá o SQL É o artefato entregue, não um detalhe de acesso.
      'infrastructure/persistence/migrations/',
      // Sonda de readiness: `SELECT 1` é um ping de conexão, não leitura de
      // dado. Passar pelo mapeamento aqui só acrescentaria indireção.
      'infrastructure/persistence/health/mysql.probe.ts',
    ],
    porque:
      'O acesso a dados passa pelo mapeamento do TypeORM — `getRepository` para o comum e ' +
      '`createQueryBuilder` para o condicional. SQL cru aqui volta a perder tipagem e a esconder ' +
      'o modelo: foi assim que o projeto passou um tempo com `entities: []` e nenhum mapeamento, ' +
      'usando o ORM só como pool de conexão. Migration é a exceção: lá o SQL É o artefato.',
  },
  {
    nome: 'SQL fora de infrastructure/persistence',
    padrao: /\b(?:SELECT\s+[\w*]|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|FOR\s+UPDATE\b)/i,
    permitidoEm: ['infrastructure/persistence/'],
    porque:
      'O decremento condicional atômico é a peça mais delicada do sistema. ' +
      'Ela mora num lugar só, para ser encontrada e revisada num lugar só.',
  },
  {
    nome: 'dinheiro tipado como number',
    // `total` sozinho ficou DE FORA da lista, e isso foi decisão, não
    // esquecimento: `meta.total` é a contagem de registros da paginação, faz
    // parte do contrato público da API e é legitimamente um number. Mantê-lo
    // aqui produzia seis falsos positivos — e regra de arquitetura que grita
    // errado é regra que o time aprende a ignorar. A contrapartida é a regra
    // seguinte, que pega a conversão, que é onde o centavo some de fato.
    padrao: /\b(totalAmount|unitPrice|price|amount|lineTotal)\s*(\?)?\s*:\s*number\b/,
    porque:
      'ADR sobre Money: dinheiro é Money (decimal.js) na aplicação e DECIMAL(12,2) no ' +
      'banco. `number` é a origem clássica do centavo que não fecha.',
  },
  {
    nome: 'conversão de valor monetário para float',
    padrao: /\b(parseFloat\s*\(|Number\s*\(\s*[\w.]*(price|amount|unitPrice|totalAmount)|\.toNumber\s*\()/i,
    porque:
      'Converter dinheiro para float destrói a precisão antes de qualquer conta. ' +
      'Money expõe `toFixed2()` justamente para que não exista caminho para number.',
  },
  {
    nome: '@ts-ignore / @ts-nocheck',
    padrao: /@ts-(ignore|nocheck)/,
    incluiComentarios: true,
    porque:
      'Desligar o compilador esconde justamente o erro que o strict mode existe para pegar. ' +
      '@ts-expect-error com justificativa é aceito; silenciar sem explicação, não.',
  },
  {
    nome: 'as any',
    padrao: /\bas\s+any\b/,
    porque: 'Um `as any` num payload de fila é como um evento malformado entra no sistema.',
  },
  {
    nome: 'setTimeout como sincronização de teste em produção',
    padrao: /\bsetTimeout\s*\(\s*\(\)\s*=>\s*\{[\s\S]{0,40}\}\s*,\s*\d{4,}\s*\)/,
    permitidoEm: ['infrastructure/', 'workers/'],
    porque:
      'Espera cega em código de aplicação vira flake e mascara falta de sinal real. ' +
      'Em infra (backoff, heartbeat) é legítimo e está declarado.',
  },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

sobreOCodigoFonte('arquitetura: invariantes de código', () => {
  it.each(RULES.map((rule) => [rule.nome, rule] as const))(
    'nenhum arquivo de produção viola: %s',
    (_nome, rule) => {
      const violations = readSourceFiles()
        .filter(
          (file) => !(rule.permitidoEm ?? []).some((prefix) => file.path.startsWith(prefix)),
        )
        .flatMap((file) => {
          // `stripComments` troca comentario por vazio preservando as quebras de
          // linha, entao o numero da linha continua apontando o lugar certo.
          const text = rule.incluiComentarios === true ? file.text : stripComments(file.text);
          const pattern = new RegExp(rule.padrao.source, `${rule.padrao.flags.replace('g', '')}g`);
          const hits: string[] = [];
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(text)) !== null) {
            hits.push(`${file.path}:${lineOf(text, match.index)} — "${match[0].trim()}"`);
          }
          return hits;
        });
      assertNoViolations(rule.porque, violations);
    },
  );
});

/**
 * Estas duas leem `test/`, não `src/`: valem desde o primeiro dia, muito antes
 * de existir código de produção.
 */
describe('arquitetura: higiene dos arquivos de teste', () => {
  it('nenhum teste está marcado com .only', () => {
    // O clássico: `it.only` sobe no PR, o CI fica verde rodando um teste só,
    // e a suíte inteira para de valer sem ninguém notar.
    const violations = readTestFiles()
      .filter((file) => /\b(describe|it|test)\.only\s*\(/.test(file.text))
      .map((file) => `${file.path} contém .only`);
    assertNoViolations('CI verde com .only é CI mentindo', violations);
  });

  it('nenhum teste está pulado sem justificativa escrita', () => {
    const violations = readTestFiles()
      .flatMap((file) => {
        const pattern = /\b(describe|it|test)\.(skip|todo)\s*\(/g;
        const hits: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(file.text)) !== null) {
          const linha = lineOf(file.text, match.index);
          const anterior = file.text.split('\n')[linha - 2] ?? '';
          if (!/\/\/|\*/.test(anterior)) hits.push(`${file.path}:${linha}`);
        }
        return hits;
      });
    assertNoViolations(
      'Teste pulado precisa de um comentário na linha acima dizendo por quê e até quando',
      violations,
    );
  });
});
