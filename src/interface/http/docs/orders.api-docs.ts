import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

import { CORRELATION_HEADER } from '../../../infrastructure/observability/correlation.constants';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { OrderResponseDto } from '../orders/dto/order-response.dto';
import { PaginatedOrdersDto } from '../orders/dto/paginated-orders.dto';
import { ReprocessAcceptedDto } from '../orders/dto/reprocess-accepted.dto';
import { ID_DO_PEDIDO } from '../http.constants';

const EXEMPLOS_DE_CRIACAO = {
  valido: {
    summary: 'Pedido válido (dois itens)',
    value: {
      customerName: 'Ana Souza',
      items: [
        { productName: 'Teclado Mecanico', quantity: 2, price: '249.90' },
        { productName: 'Mouse Sem Fio', quantity: 3, price: '89.90' },
      ],
    },
  },
  estoqueInsuficiente: {
    summary: 'Cenário de falha: pede mais do que existe (catálogo nasce com 5)',
    description: 'Aceito com 201 PENDING; o worker o reprova com "estoque insuficiente".',
    value: {
      customerName: 'Cliente Ambicioso',
      items: [{ productName: 'Headset Gamer', quantity: 99, price: '319.50' }],
    },
  },
  gatilhoDeFalha: {
    summary: 'Cenário de falha: "fail" no nome dispara erro transitório',
    description:
      'Exercita a máquina completa: 4 tentativas, 3 degraus de espera (5s, 15s, 45s) e dead-letter. ' +
      'Leva cerca de 65 s até o pedido virar FAILED com RETRIES_EXHAUSTED.',
    value: {
      customerName: 'Cliente fail teste',
      items: [{ productName: 'Webcam Full HD', quantity: 1, price: '199.99' }],
    },
  },
  produtoInexistente: {
    summary: 'Produto fora do catálogo → 422',
    value: {
      customerName: 'Ana Souza',
      items: [{ productName: 'Produto Fantasma', quantity: 1, price: '10.00' }],
    },
  },
};

export const DocumentaCriacaoDePedido = (): MethodDecorator =>
  applyDecorators(
    ApiOperation({
      summary: 'Cria um pedido (responde na hora, sem esperar o estoque)',
      description:
        'Calcula o total, grava o pedido como PENDING e o evento `order.created` na MESMA transação, ' +
        'e responde. O estoque é validado depois, pelo worker — por exigência do enunciado. ' +
        'Consulte `GET /orders/{id}` alguns segundos depois para ver PROCESSED ou FAILED.',
    }),
    ApiHeader({
      name: CORRELATION_HEADER,
      required: false,
      description:
        'Opcional. Se você mandar, ele é respeitado e volta na resposta; se não, a API gera um. ' +
        'É o id que atravessa API, relay e worker nos logs.',
    }),
    ApiBody({ type: CreateOrderDto, examples: EXEMPLOS_DE_CRIACAO }),
    ApiResponse({ status: 201, description: 'Pedido criado com status PENDING.', type: OrderResponseDto }),
    ApiResponse({ status: 400, description: 'Entrada inválida — nada é gravado.', type: ErrorResponseDto }),
    ApiResponse({
      status: 422,
      description: 'Produto fora do catálogo. A rota existe; o corpo é que referencia algo que não há.',
      type: ErrorResponseDto,
    }),
  );

export const DocumentaListagemDePedidos = (): MethodDecorator =>
  applyDecorators(
    ApiOperation({
      summary: 'Lista pedidos com paginação simples',
      description: 'Ordenado do mais recente para o mais antigo. `limit` tem teto declarado de 100.',
    }),
    ApiResponse({ status: 200, description: 'Página de pedidos com metadados.', type: PaginatedOrdersDto }),
    ApiResponse({
      status: 400,
      description: 'page < 1, limit fora de 1..100 ou status fora do enum.',
      type: ErrorResponseDto,
    }),
  );

export const DocumentaConsultaDePedido = (): MethodDecorator =>
  applyDecorators(
    ApiOperation({
      summary: 'Consulta um pedido pelo id, com o status atual',
      description: 'É aqui que se vê o resultado do processamento assíncrono, incluindo o motivo da falha.',
    }),
    ApiParam(ID_DO_PEDIDO),
    ApiResponse({ status: 200, description: 'Pedido encontrado.', type: OrderResponseDto }),
    ApiResponse({ status: 400, description: 'Id malformado (não é UUID).', type: ErrorResponseDto }),
    ApiResponse({ status: 404, description: 'Pedido inexistente.', type: ErrorResponseDto }),
  );

export const DocumentaReprocessamento = (): MethodDecorator =>
  applyDecorators(
    ApiOperation({
      summary: 'Reenfileira um pedido FAILED (exige papel ADMIN)',
      description:
        'Devolve o pedido para PENDING e grava um event_id NOVO na outbox. Mesmo assim não decrementa ' +
        'o estoque duas vezes: a constraint UNIQUE(order_id, product_id) não depende da inbox. ' +
        'Autentique-se como admin@loja.test / admin123 para usar.',
    }),
    ApiParam(ID_DO_PEDIDO),
    ApiResponse({ status: 202, description: 'Aceito; o pedido voltou para PENDING.', type: ReprocessAcceptedDto }),
    ApiResponse({ status: 403, description: 'Autenticado, mas sem o papel ADMIN.', type: ErrorResponseDto }),
    ApiResponse({ status: 404, description: 'Pedido inexistente.', type: ErrorResponseDto }),
    ApiResponse({
      status: 409,
      description: 'O pedido não está FAILED — só um pedido FAILED pode ser reprocessado.',
      type: ErrorResponseDto,
    }),
  );
