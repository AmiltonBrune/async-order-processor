import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/** Catálogo semeado pela migration. Estoque inicial de 5 unidades em cada. */
export const PRODUTOS = [
  { nome: 'Teclado Mecanico', preco: '249.90' },
  { nome: 'Mouse Sem Fio', preco: '89.90' },
  { nome: 'Monitor 27 polegadas', preco: '1499.00' },
  { nome: 'Headset Gamer', preco: '319.50' },
  { nome: 'Webcam Full HD', preco: '199.99' },
];

/**
 * Autentica uma vez no `setup()` e compartilha o token com todos os VUs.
 *
 * Fazer login por iteração mediria o scrypt do hash de senha, não o caminho do
 * pedido — e o scrypt é deliberadamente lento. O gargalo medido seria o errado.
 */
export function autenticar(email = 'cliente@loja.test', senha = 'cliente123') {
  const resposta = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: senha }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  if (resposta.status !== 200) {
    fail(`login falhou: ${resposta.status} ${resposta.body}`);
  }
  return resposta.json('accessToken');
}

export function cabecalhos(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export function criarPedido(token, opcoes = {}) {
  const produto = opcoes.produto || PRODUTOS[Math.floor(Math.random() * PRODUTOS.length)];
  const corpo = {
    customerName: opcoes.cliente || `Carga VU${__VU} iter${__ITER}`,
    items: [
      {
        productName: produto.nome,
        quantity: opcoes.quantidade || 1,
        price: produto.preco,
      },
    ],
  };
  return http.post(`${BASE_URL}/orders`, JSON.stringify(corpo), {
    headers: cabecalhos(token),
    tags: { name: 'create_order' },
  });
}

export function consultarPedido(token, id) {
  return http.get(`${BASE_URL}/orders/${id}`, {
    headers: cabecalhos(token),
    tags: { name: 'get_order' },
  });
}

/** Usa `meta.total` em vez de paginar: uma requisição por contagem. */
export function contarPorStatus(token, status) {
  const resposta = http.get(`${BASE_URL}/orders?status=${status}&page=1&limit=1`, {
    headers: cabecalhos(token),
    tags: { name: 'count_orders' },
  });
  return resposta.status === 200 ? resposta.json('meta.total') : -1;
}

export function checarCriacao(resposta) {
  return check(
    resposta,
    {
      'POST /orders responde 201': (r) => r.status === 201,
      'pedido nasce PENDING': (r) => r.status === 201 && r.json('status') === 'PENDING',
      'total vem como string decimal': (r) =>
        r.status === 201 && typeof r.json('total') === 'string',
      'resposta traz x-correlation-id': (r) => Boolean(r.headers['X-Correlation-Id']),
    },
    { endpoint: 'POST /orders' },
  );
}
