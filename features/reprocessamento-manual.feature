# language: pt
@us-07 @b2 @api @bonus
Funcionalidade: Reprocessamento manual de pedido FAILED

  Como operador da loja
  Quero reenfileirar um pedido que falhou
  Para resolver o caso do cliente depois que a causa da falha foi corrigida

  A sutileza: reprocessar gera um event_id novo (atravessa a inbox de
  propósito) e devolve o status para PENDING (atravessa a checagem de estado),
  mas continua sem conseguir decrementar o estoque duas vezes, porque a
  constraint UNIQUE(order_id, product_id) não depende de nenhuma das duas.

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |
    E que estou autenticado com o papel "ADMIN"

  @happy-path
  Cenário: Pedido FAILED volta para a fila
    Dado um pedido "FAILED" de "Ana Souza" com "INSUFFICIENT_STOCK" e 2 unidades de "Teclado"
    E que o estoque de "Teclado" foi reposto para 5
    Quando eu envio "POST /orders/{id}/reprocess"
    Então a resposta tem status 202
    E o pedido fica com status "PENDING"
    E os campos "failure_code" e "failure_reason" ficam nulos
    E existe uma nova linha "PENDING" em "outbox_messages" para esse pedido
    E o event_id dessa linha é diferente do event_id do evento original
    E em até 5 segundos o pedido está "PROCESSED"
    E o estoque de "Teclado" é 3

  @estado-invalido
  Esquema do Cenário: Só pedido FAILED pode ser reprocessado
    Dado um pedido de "Ana Souza" no status "<status>"
    Quando eu envio "POST /orders/{id}/reprocess"
    Então a resposta tem status 409
    E o campo "code" do corpo de erro é "ORDER_NOT_REPROCESSABLE"
    E o status do pedido continua "<status>"
    E nenhuma linha nova é criada em "outbox_messages"

    Exemplos:
      | status    |
      | PENDING   |
      | PROCESSED |

  @corrida @idempotencia
  Cenário: Dois cliques no botão de reprocessar
    Dado um pedido "FAILED" de "Ana Souza" com 2 unidades de "Teclado"
    Quando eu envio "POST /orders/{id}/reprocess" 2 vezes em paralelo
    Então exatamente 1 resposta tem status 202
    E exatamente 1 resposta tem status 409
    E existe exatamente 1 linha nova em "outbox_messages" para esse pedido

  @idempotencia @critico
  Cenário: Reprocessar um pedido que já tinha reservado estoque não decrementa de novo
    Dado um pedido "FAILED" de "Ana Souza" que já possui reserva de 2 unidades de "Teclado"
    E o estoque de "Teclado" em 3
    Quando eu envio "POST /orders/{id}/reprocess"
    E o consumidor processa o novo evento
    Então o estoque de "Teclado" continua 3
    E existe exatamente 1 linha em "stock_reservations" para esse pedido

  @autorizacao
  Cenário: Reprocessar é ação de operador
    Dado um pedido "FAILED" de "Ana Souza"
    E que estou autenticado com o papel "CUSTOMER"
    Quando eu envio "POST /orders/{id}/reprocess"
    Então a resposta tem status 403
    E o status do pedido continua "FAILED"

  @404
  Cenário: Reprocessar pedido inexistente
    Quando eu envio "POST /orders/0192f3c0-0000-7000-8000-000000000000/reprocess"
    Então a resposta tem status 404
    E o campo "code" do corpo de erro é "ORDER_NOT_FOUND"
