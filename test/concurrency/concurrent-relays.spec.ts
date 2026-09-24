import {
  OutboxDispatchRepository,
  PendingMessage,
} from '../../src/infrastructure/persistence/outbox/outbox-dispatch.repository';
import { largarJuntas } from '../support/barreira';
import { Contexto } from '../support/steps';
import { useWorld } from '../support/setup-world';

const world = useWorld();

describe('dois relays sobre a mesma outbox', () => {
  let ctx: Contexto;

  beforeEach(async () => {
    ctx = new Contexto(world());
    await ctx.catalogo([{ nome: 'Teclado', preco: '10.00', estoque: '50' }]);
    await ctx.autenticar('CUSTOMER');
  });

  it('nenhuma mensagem é reservada por dois relays ao mesmo tempo', async () => {
    const TOTAL = 12;
    for (let i = 0; i < TOTAL; i += 1) {
      await ctx.criarPedido(`Cliente ${i}`, [{ produto: 'Teclado', quantidade: '1' }]);
    }

    const relayA = new OutboxDispatchRepository(world().dataSource);
    const relayB = new OutboxDispatchRepository(world().dataSource);
    const agora = new Date();

    const resultados = await largarJuntas([
      () => relayA.claimBatch(TOTAL, agora),
      () => relayB.claimBatch(TOTAL, agora),
    ]);

    const lotes = resultados
      .filter(
        (r): r is PromiseFulfilledResult<readonly PendingMessage[]> => r.status === 'fulfilled',
      )
      .map((r) => r.value.map((mensagem) => mensagem.id));

    const todos = lotes.flat();
    // Nenhum id aparece nos dois lotes: o segundo relay pulou o que o primeiro
    // travou, em vez de esperar por ele ou publicar de novo.
    expect(new Set(todos).size).toBe(todos.length);
    expect(todos).toHaveLength(TOTAL);
  });

  it('a mensagem reservada some da vista do outro relay até ser publicada', async () => {
    await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '1' }]);
    const relayA = new OutboxDispatchRepository(world().dataSource);
    const relayB = new OutboxDispatchRepository(world().dataSource);

    const primeiro = await relayA.claimBatch(10, new Date());
    const segundo = await relayB.claimBatch(10, new Date());

    expect(primeiro).toHaveLength(1);
    // `available_at` adiado no mesmo lock: depois do commit, a linha continua
    // invisível para os outros relays mesmo com o lock já liberado.
    expect(segundo).toHaveLength(0);
  });
});
