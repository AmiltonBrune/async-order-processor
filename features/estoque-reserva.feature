# language: pt
@us-05 @rn1 @rn2 @rn4 @critico
Funcionalidade: Reserva de estoque

  Como dono do negócio
  Quero que o pedido só seja confirmado depois de reservar o estoque
  Para não confirmar uma venda que eu não consigo entregar

  O estoque é decrementado por "UPDATE products SET stock = stock - :q WHERE
  id = :id AND stock >= :q": quem conseguir affectedRows = 1 levou; quem receber 0
  falha com "estoque insuficiente". Nenhuma decisão de "cabe ou não cabe" é tomada
  na aplicação a partir de uma leitura anterior.

  O comportamento sob paralelismo real está em `estoque-concorrencia.feature`,
  que tem dono próprio: a suíte de `test/concurrency/`.

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |
      | Mouse   | 3.33  | 5       |

  @rn2 @falha-real
  Cenário: Estoque insuficiente reprova o pedido sem mexer no catálogo
    Dado um pedido PENDING de "Ana Souza" com 6 unidades de "Teclado"
    Quando o consumidor processa a mensagem
    Então o pedido fica com status "FAILED"
    E o campo "failure_code" é "INSUFFICIENT_STOCK"
    E o campo "failure_reason" é "estoque insuficiente"
    E o estoque de "Teclado" continua 5
    E não existe nenhuma linha em "stock_reservations" para esse pedido
    E a mensagem é confirmada sem retry e sem dead-letter

  @rn2 @borda
  Esquema do Cenário: A borda exata do estoque
    Dado um pedido PENDING de "Ana Souza" com <qtd> unidades de "Teclado"
    Quando o consumidor processa a mensagem
    Então o pedido fica com status "<status>"
    E o estoque de "Teclado" é <estoque_final>

    Exemplos:
      | qtd | status    | estoque_final | observacao       |
      | 4   | PROCESSED | 1             | cabe com folga   |
      | 5   | PROCESSED | 0             | cabe exatamente  |
      | 6   | FAILED    | 5             | não cabe por 1   |

  @rn4 @idempotencia @critico
  Cenário: Reentrega da mesma mensagem não decrementa duas vezes
    Dado um pedido PENDING de "Ana Souza" com 2 unidades de "Teclado"
    E o evento "order.created" desse pedido já processado com sucesso
    Quando a mesma mensagem, com o mesmo event_id, é entregue de novo
    Então o estoque de "Teclado" continua 3
    E existe exatamente 1 linha em "stock_reservations" para esse pedido
    E o pedido continua "PROCESSED"
    E a segunda entrega é confirmada sem erro

  @rn4 @idempotencia
  Cenário: A constraint segura mesmo sem a inbox
    Dado um pedido PENDING de "Ana Souza" com 2 unidades de "Teclado"
    E o evento desse pedido já processado com sucesso
    E que a inbox foi limpa manualmente
    E que o pedido foi devolvido para "PENDING" manualmente
    Quando a mesma mensagem é entregue de novo
    Então o estoque de "Teclado" continua 3
    E a transação foi revertida por violação de "uq_stock_reservations_order_product"
