import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

import { autenticar, consultarPedido, criarPedido } from './lib/api.js';

/**
 * Carga no caminho COMPLETO: `POST /orders` → outbox → relay → RabbitMQ →
 * worker → `PROCESSED`.
 *
 * Mede a coisa que o cliente sente de verdade: quanto tempo o pedido leva para
 * sair de PENDING. É o único teste que enxerga a soma de todas as latências da
 * cadeia — o intervalo de polling do relay (500 ms), o `PROCESSING_DELAY_MS`
 * (1,5 s) e, quando a carga passa da capacidade do worker, a fila crescendo.
 *
 * O `POST` continuar rápido enquanto este número sobe É o desacoplamento
 * funcionando. Os dois subirem juntos seria o sinal de que não há fila de fato.
 */
const conclusao = new Trend('conclusao_ms', true);
const naoConcluidos = new Counter('nao_concluidos');
const processados = new Counter('processados');
const reprovados = new Counter('reprovados');

const TIMEOUT_MS = Number(__ENV.COMPLETION_TIMEOUT_MS || 60000);

export const options = {
  scenarios: {
    constante: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 5),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Number(__ENV.VUS || 40),
      maxVUs: Number(__ENV.MAX_VUS || 120),
    },
  },
  thresholds: {
    'http_req_duration{name:create_order}': ['p(95)<300'],
    nao_concluidos: ['count==0'],
    // Sem teto no tempo de conclusão, uma fila crescendo sem limite passaria
    // despercebida: cada pedido termina, só que dez minutos depois.
    conclusao_ms: [`p(95)<${TIMEOUT_MS}`],
  },
};

export function setup() {
  return { token: autenticar() };
}

export default function (dados) {
  const inicio = Date.now();
  const criado = criarPedido(dados.token, { quantidade: 1 });
  if (!check(criado, { 'pedido criado': (r) => r.status === 201 })) return;

  const id = criado.json('id');
  let status = 'PENDING';

  while (status === 'PENDING' && Date.now() - inicio < TIMEOUT_MS) {
    const consulta = consultarPedido(dados.token, id);
    if (consulta.status === 200) status = consulta.json('status');
    if (status === 'PENDING') {
      // 250 ms: sleep longo arredondaria a latência medida para o tamanho do
      // próprio sleep; curto demais viraria polling agressivo contra a API.
      sleep(0.25);
    }
  }

  if (status === 'PENDING') {
    naoConcluidos.add(1);
    return;
  }
  conclusao.add(Date.now() - inicio);
  if (status === 'PROCESSED') processados.add(1);
  else reprovados.add(1);
}
