import { Trend } from 'k6/metrics';

import { autenticar, checarCriacao, criarPedido } from './lib/api.js';

/**
 * Rampa até a ruptura.
 *
 * Os outros cenários medem a curva dentro da faixa de operação. Este procura o
 * ponto em que ela deixa de valer: sobe a concorrência em degraus e registra
 * onde a latência dispara ou o erro aparece.
 *
 * Não há *threshold* de aprovação de propósito — um stress test que "falha" não
 * informa nada. O resultado é a tabela de degraus, lida à mão.
 */
const latenciaCriacao = new Trend('criacao_ms', true);

const DEGRAUS = (__ENV.STAGES || '25,50,100,200,400')
  .split(',')
  .map((vus) => Number(vus.trim()))
  .filter((vus) => Number.isFinite(vus) && vus > 0);

const DURACAO_DO_DEGRAU = __ENV.STAGE_DURATION || '30s';

export const options = {
  scenarios: {
    rampa: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: DEGRAUS.flatMap((vus) => [
        { duration: '10s', target: vus },
        { duration: DURACAO_DO_DEGRAU, target: vus },
      ]).concat([{ duration: '10s', target: 0 }]),
      gracefulRampDown: '10s',
    },
  },
  // Sem thresholds: o objetivo é encontrar o limite, não passar.
  thresholds: {},
  summaryTrendStats: ['avg', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return { token: autenticar() };
}

export default function (dados) {
  const resposta = criarPedido(dados.token);
  latenciaCriacao.add(resposta.timings.duration);
  checarCriacao(resposta);
}

export function handleSummary(data) {
  const criacao = data.metrics.criacao_ms ? data.metrics.criacao_ms.values : {};
  const falhas = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0;
  const total = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;

  const linhas = [
    '',
    '=== rampa de stress ===',
    `degraus (VUs):      ${DEGRAUS.join(' -> ')}`,
    `requisicoes:        ${total}`,
    `taxa de erro:       ${(falhas * 100).toFixed(2)}%`,
    `criacao p95:        ${Number(criacao['p(95)'] || 0).toFixed(0)} ms`,
    `criacao p99:        ${Number(criacao['p(99)'] || 0).toFixed(0)} ms`,
    `criacao max:        ${Number(criacao.max || 0).toFixed(0)} ms`,
    '',
    'Leitura: o degrau em que p95 dispara e o erro sai de zero e o ponto de',
    'saturacao. Rode com STAGES e STAGE_DURATION para estreitar em volta dele.',
    '',
  ].join('\n');

  return { stdout: linhas };
}
