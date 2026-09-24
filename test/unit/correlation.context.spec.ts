import { CorrelationContext } from '../../src/infrastructure/observability/correlation.context';

describe('CorrelationContext', () => {
  it('mantem o id atraves de await', async () => {
    await CorrelationContext.run('corr-1', async () => {
      await new Promise((resolve) => setImmediate(resolve));
      expect(CorrelationContext.current()).toBe('corr-1');
    });
  });

  it('mantem o id dentro de callback assincrono, que e onde ele costuma sumir', async () => {
    await CorrelationContext.run('corr-2', async () => {
      const visto = await new Promise<string | undefined>((resolve) => {
        setImmediate(() => resolve(CorrelationContext.current()));
      });
      expect(visto).toBe('corr-2');
    });
  });

  it('isola contextos concorrentes', async () => {
    const [a, b] = await Promise.all([
      CorrelationContext.run('a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return CorrelationContext.current();
      }),
      CorrelationContext.run('b', async () => CorrelationContext.current()),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
  });

  it('nao vaza id para fora do escopo', () => {
    CorrelationContext.run('corr-3', () => undefined);
    expect(CorrelationContext.current()).toBeUndefined();
  });

  it('respeita o id que o cliente mandou e gera quando nao vem', () => {
    expect(CorrelationContext.resolve('  vindo-do-cliente  ')).toBe('vindo-do-cliente');
    expect(CorrelationContext.resolve(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(CorrelationContext.resolve('   ')).toMatch(/^[0-9a-f-]{36}$/);
    expect(CorrelationContext.resolve(42)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('anexa o orderId ao contexto corrente', () => {
    CorrelationContext.run('corr-4', () => {
      CorrelationContext.attachOrderId('order-9');
      expect(CorrelationContext.currentOrderId()).toBe('order-9');
    });
  });
});
