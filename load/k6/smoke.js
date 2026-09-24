import { check, sleep } from 'k6';

import { autenticar, checarCriacao, consultarPedido, criarPedido } from './lib/api.js';

/**
 * Smoke: 1 usuário, o fluxo inteiro, uma vez.
 *
 * Não mede desempenho — verifica que o ambiente está de pé e que os scripts de
 * carga estão falando com a API certa. Rodar um teste de carga contra uma stack
 * quebrada produz números que parecem ruins e não significam nada.
 */
export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.00'],
    http_req_failed: ['rate==0.00'],
  },
};

export function setup() {
  return { token: autenticar() };
}

export default function (dados) {
  const criado = criarPedido(dados.token, { quantidade: 1 });
  checarCriacao(criado);
  if (criado.status !== 201) return;

  const id = criado.json('id');

  // Espera o worker concluir. O `PROCESSING_DELAY_MS` padrão é 1,5 s, mais o
  // ciclo do relay: 10 tentativas de 1 s cobrem com folga.
  let final = null;
  for (let tentativa = 0; tentativa < 10 && final === null; tentativa += 1) {
    sleep(1);
    const consulta = consultarPedido(dados.token, id);
    const status = consulta.json('status');
    if (status === 'PROCESSED' || status === 'FAILED') final = status;
  }

  check(final, {
    'o worker concluiu o pedido sozinho': (s) => s === 'PROCESSED' || s === 'FAILED',
    'processou com sucesso (ha estoque)': (s) => s === 'PROCESSED',
  });
}
