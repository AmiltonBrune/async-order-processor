import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

import { autenticar, contarPorStatus, criarPedido } from './lib/api.js';

/**
 * O cenário obrigatório do enunciado, sob carga real e pela HTTP.
 *
 * A suíte `test/concurrency/oversell.spec.ts` prova a mesma coisa chamando o
 * caso de uso em processo, com barreira de largada. Este aqui prova pelo lado de
 * fora: N requisições HTTP simultâneas contra a API em containers separados,
 * passando por outbox, relay, RabbitMQ e worker.
 *
 * A diferença importa. O teste em processo controla o paralelismo e garante
 * simultaneidade; este não controla nada, e é justamente por isso que ele pode
 * encontrar um modo de falha que o outro não alcança — pool de conexões, número
 * de consumidores, prefetch.
 *
 * Pré-requisito: estoque em valor conhecido. Rode `npm run load:prep` antes.
 */
const criados = new Counter('pedidos_criados');

const ESTOQUE = Number(__ENV.ESTOQUE || 5);
const PEDIDOS = Number(__ENV.PEDIDOS || 40);
const PRODUTO = { nome: __ENV.PRODUTO || 'Webcam Full HD', preco: '199.99' };

export const options = {
  scenarios: {
    avalanche: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS || 20),
      iterations: PEDIDOS,
      maxDuration: '60s',
    },
  },
  thresholds: {
    'http_req_failed{name:create_order}': ['rate==0.00'],
    checks: ['rate==1.00'],
  },
};

export function setup() {
  const token = autenticar();
  return { token };
}

export default function (dados) {
  const resposta = criarPedido(dados.token, { produto: PRODUTO, quantidade: 1 });
  check(resposta, { 'pedido aceito com 201': (r) => r.status === 201 });
  if (resposta.status === 201) criados.add(1);
}

/**
 * A verificação decisiva roda no teardown, depois de a fila drenar.
 *
 * Contar `PROCESSED` pela própria API fecha o ciclo sem precisar de acesso ao
 * banco: se o número passar do estoque inicial, houve overselling — e nenhuma
 * métrica de latência teria denunciado isso.
 */
export function teardown(dados) {
  let pendentes = -1;
  for (let tentativa = 0; tentativa < 60 && pendentes !== 0; tentativa += 1) {
    sleep(1);
    pendentes = contarPorStatus(dados.token, 'PENDING');
  }

  const processados = contarPorStatus(dados.token, 'PROCESSED');
  const reprovados = contarPorStatus(dados.token, 'FAILED');

  console.log(`estoque inicial declarado : ${ESTOQUE}`);
  console.log(`pedidos enviados          : ${PEDIDOS}`);
  console.log(`PROCESSED                 : ${processados}`);
  console.log(`FAILED                    : ${reprovados}`);
  console.log(`PENDING restantes         : ${pendentes}`);

  const ok = check(
    { processados, reprovados, pendentes },
    {
      'nenhum pedido ficou preso em PENDING': (r) => r.pendentes === 0,
      'confirmados nunca passam do estoque inicial': (r) => r.processados <= ESTOQUE,
      'o estoque foi distribuido por inteiro': (r) => r.processados === ESTOQUE,
      'todo pedido que nao coube virou FAILED': (r) => r.processados + r.reprovados === PEDIDOS,
    },
  );
  if (!ok) {
    throw new Error('Overselling ou pedido preso sob carga — ver contagens acima.');
  }
}
