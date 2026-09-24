import { CorrelationContext } from '../../src/infrastructure/observability/correlation.context';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';

const capturar = (executar: (logger: StructuredLogger) => void): Array<Record<string, unknown>> => {
  const linhas: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    linhas.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  try {
    executar(new StructuredLogger('trace', 'test'));
  } finally {
    process.stdout.write = original;
  }
  return linhas
    .filter((linha) => linha.trim().startsWith('{'))
    .map((linha) => JSON.parse(linha) as Record<string, unknown>);
};

describe('StructuredLogger', () => {
  it.each([
    ['log', 30],
    ['warn', 40],
    ['error', 50],
    ['debug', 20],
    ['verbose', 10],
  ])('escreve %s no nível certo', (metodo, nivel) => {
    const [linha] = capturar((logger) => {
      (logger[metodo as 'log'] as (m: string) => void)('mensagem');
    });
    expect(linha).toMatchObject({ level: nivel, msg: 'mensagem' });
  });

  it('acrescenta o correlationId corrente sem quem chama precisar lembrar', () => {
    const [linha] = capturar((logger) => {
      CorrelationContext.run('corr-1', () => {
        CorrelationContext.attachOrderId('order-9');
        logger.log('processando');
      });
    });
    expect(linha).toMatchObject({ correlationId: 'corr-1', orderId: 'order-9' });
  });

  it('omite os campos de correlação fora de um contexto', () => {
    const [linha] = capturar((logger) => logger.log('fora de requisicao'));
    expect(linha).not.toHaveProperty('correlationId');
    expect(linha).not.toHaveProperty('orderId');
  });

  it('identifica o serviço e o papel do processo', () => {
    const [linha] = capturar((logger) => logger.log('oi'));
    expect(linha).toMatchObject({ service: 'async-order-processor', role: 'test' });
  });

  it.each(['password', 'senha', 'authorization', 'accessToken', 'passwordHash'])(
    'redige o campo sensível %s',
    (campo) => {
      const [linha] = capturar((logger) => logger.log('tentativa', { [campo]: 'nao-pode-vazar' }));
      expect(linha?.[campo]).toBe('[REDACTED]');
      expect(JSON.stringify(linha)).not.toContain('nao-pode-vazar');
    },
  );

  it('o nível silent não escreve nada', () => {
    const linhas = capturar(() => {
      new StructuredLogger('silent', 'test').error('deveria sumir');
    });
    expect(linhas).toHaveLength(0);
  });
});
