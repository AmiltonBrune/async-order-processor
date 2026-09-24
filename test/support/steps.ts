import request from 'supertest';
import { Response } from 'supertest';

import { OrderCreatedEvent } from '../../src/domain/order/events/order-created.event';
import { ProcessOrderOutcome } from '../../src/application/process-order/process-order.command';
import { World } from './world';

export interface LinhaCatalogo {
  nome: string;
  preco: string;
  estoque: string;
}

export interface LinhaItem {
  produto: string;
  quantidade: string;
}

let contador = 0;
const proximoId = (): string => {
  contador += 1;
  return `0193b000-0000-7000-8000-${String(contador).padStart(12, '0')}`;
};

export class Contexto {
  resposta: Response | null = null;
  respostas: Response[] = [];
  pedidoId = '';
  correlationId = '';
  token: string | null = null;
  ultimoEventId = '';

  constructor(readonly world: World) {}

  async catalogo(linhas: readonly LinhaCatalogo[]): Promise<void> {
    await this.world.seedCatalog(
      linhas.map((linha) => ({
        nome: linha.nome,
        preco: linha.preco,
        estoque: Number(linha.estoque),
      })),
    );
  }

  async autenticar(papel: string): Promise<void> {
    const email = papel === 'ADMIN' ? 'admin@loja.test' : 'cliente@loja.test';
    const senha = papel === 'ADMIN' ? 'admin123' : 'cliente123';
    const resposta = await this.http().post('/auth/login').send({ email, password: senha });
    this.token = String((resposta.body as { accessToken?: string }).accessToken ?? '');
  }

  http(): request.Agent {
    return request(this.world.httpServer as Parameters<typeof request>[0]);
  }

  /** Toda chamada autenticada passa por aqui: o token vai junto se houver. */
  autorizar(req: request.Test): request.Test {
    return this.token === null ? req : req.set('authorization', `Bearer ${this.token}`);
  }

  async post(rota: string, corpo: unknown, headers: Record<string, string> = {}): Promise<Response> {
    let req = this.autorizar(this.http().post(rota));
    for (const [nome, valor] of Object.entries(headers)) req = req.set(nome, valor);
    this.resposta = await req.send(corpo as object);
    this.respostas.push(this.resposta);
    this.registrarPedido();
    return this.resposta;
  }

  async get(rota: string): Promise<Response> {
    this.resposta = await this.autorizar(this.http().get(rota));
    this.respostas.push(this.resposta);
    return this.resposta;
  }

  private registrarPedido(): void {
    const id = (this.resposta?.body as { id?: string } | undefined)?.id;
    if (typeof id === 'string') {
      this.pedidoId = id;
      this.correlationId = String(this.resposta?.headers['x-correlation-id'] ?? '');
    }
  }

  corpoPadrao(cliente = 'Ana Souza'): Record<string, unknown> {
    return {
      customerName: cliente,
      items: [{ productName: 'Teclado', quantity: 2, price: '10.00' }],
    };
  }

  /** Cria o pedido pela API e devolve o id — o caminho que o cliente percorre. */
  async criarPedido(cliente: string, itens?: ReadonlyArray<LinhaItem>): Promise<string> {
    const corpo =
      itens === undefined
        ? this.corpoPadrao(cliente)
        : {
            customerName: cliente,
            items: itens.map((item) => ({
              productName: item.produto,
              quantity: Number(item.quantidade),
              price: '10.00',
            })),
          };
    const resposta = await this.post('/orders', corpo);
    if (resposta.status !== 201) {
      throw new Error(`Falha ao criar pedido no cenario: ${resposta.status} ${resposta.text}`);
    }
    return this.pedidoId;
  }

  /** O evento que o relay publicaria, entregue direto ao caso de uso. */
  async processar(
    orderId = this.pedidoId,
    opcoes: { eventId?: string; attempt?: number } = {},
  ): Promise<ProcessOrderOutcome> {
    const eventId = opcoes.eventId ?? proximoId();
    this.ultimoEventId = eventId;
    return this.world.processOrder.execute({
      eventId,
      orderId,
      correlationId: this.correlationId,
      consumer: this.world.env.consumerName,
      attempt: opcoes.attempt ?? 1,
    });
  }

  /** Publica o evento no broker de verdade, para exercitar consumidor e filas. */
  async publicar(orderId = this.pedidoId, eventId = proximoId()): Promise<void> {
    this.ultimoEventId = eventId;
    // O `correlationId` é gerado quando o cenário não criou pedido nenhum. Sem
    // isso o envelope saía sem o campo, o consumidor o recusava como
    // MALFORMED_EVENT — e cenários que queriam exercitar OUTRA coisa passavam
    // pelo motivo errado: a mensagem ia mesmo para a dead-letter, só que por
    // payload inválido, sem nunca chegar ao caminho que diziam testar.
    const correlationId = this.correlationId === '' ? proximoId() : this.correlationId;
    this.correlationId = correlationId;
    const evento = new OrderCreatedEvent(eventId, orderId, correlationId, new Date());
    await this.world.publisher.publishCreated({ ...evento.toPayload() }, correlationId);
  }

  async esperarStatus(status: string, orderId = this.pedidoId): Promise<void> {
    await this.world.waitFor(`pedido ${orderId} virar ${status}`, async () => {
      const row = await this.world.orderById(orderId);
      return row.status === status ? row : null;
    });
  }

  static novoId(): string {
    return proximoId();
  }
}
