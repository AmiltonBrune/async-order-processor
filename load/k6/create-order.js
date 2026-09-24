import { Trend } from 'k6/metrics';

import { autenticar, checarCriacao, criarPedido } from './lib/api.js';

/**
 * Carga no CAMINHO SÍNCRONO: `POST /orders`.
 *
 * É o número que a arquitetura promete. O POST não fala com o broker — ele grava
 * o pedido e a linha da outbox numa transação e responde. Se o p95 subir junto
 * com a carga do worker, a promessa do desacoplamento está quebrada.
 *
 * Por isso o *threshold* de latência é sobre `create_order` especificamente, e
 * não sobre `http_req_duration` global: o login do setup e as consultas
 * contaminariam a média.
 */
const latenciaCriacao = new Trend('criacao_ms', true);

export const options = {
  scenarios: {
    rampa: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP_UP || '15s', target: Number(__ENV.VUS || 30) },
        { duration: __ENV.HOLD || '45s', target: Number(__ENV.VUS || 30) },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // O POST não espera broker nem worker: 300 ms no p95 é folgado para uma
    // transação com dois INSERTs, e apertado o bastante para denunciar se
    // alguém enfiar uma chamada de rede no caminho.
    'http_req_duration{name:create_order}': ['p(95)<300', 'p(99)<800'],
    'http_req_failed{name:create_order}': ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return { token: autenticar() };
}

export default function (dados) {
  const resposta = criarPedido(dados.token, { quantidade: 1 });
  checarCriacao(resposta);
  latenciaCriacao.add(resposta.timings.duration);
}
