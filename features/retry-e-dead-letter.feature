# language: pt
@us-06 @rf5 @worker @falha-real
Funcionalidade: Retentativa e dead-letter

  Como pessoa de plantão
  Quero que erro passageiro seja retentado e erro persistente vá para uma fila morta
  Para não perder pedido e ainda assim não segurar uma mensagem envenenada para sempre

  A distinção que governa tudo aqui: erro de negócio (estoque insuficiente)
  não é retentável — retentar não muda o resultado. O único erro de negócio que
  o worker produz é `INSUFFICIENT_STOCK`: "produto inexistente" é impossível
  aqui, porque a FK `ON DELETE RESTRICT` de `order_items` impede que um produto
  referenciado por um pedido desapareça. Erro transitório (deadlock,
  banco fora, o gatilho "fail" do enunciado) ganha 3 retentativas com backoff
  5s, 15s, 45s — quatro tentativas de processamento ao todo — e depois vai para
  "orders.dead". Na suíte os degraus são curtos, por configuração; o que se
  prova é a mecânica, não a duração.

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |

  @gatilho-do-enunciado @critico
  Cenário: customerName com "fail" esgota as tentativas e vai para a dead-letter
    Dado um pedido PENDING de "Cliente fail teste" com 1 unidade de "Teclado"
    Quando o consumidor processa a mensagem até esgotar as tentativas
    Então foram observadas exatamente 4 tentativas de processamento
    E a mensagem passou pelos 3 degraus de espera, na ordem
    E existe 1 mensagem na fila "orders.dead"
    E o pedido fica com status "FAILED"
    E o campo "failure_code" é "RETRIES_EXHAUSTED"
    E o campo "failure_reason" contém a mensagem real do erro
    E o campo "processing_attempts" do pedido é 4
    E o estoque de "Teclado" continua 5

  @retry @recuperacao
  Cenário: Erro transitório que passa na segunda tentativa
    Dado um pedido PENDING de "Ana Souza" com 1 unidade de "Teclado"
    E que a primeira tentativa vai falhar com "ER_LOCK_DEADLOCK"
    Quando o consumidor processa a mensagem
    Então a mensagem é retentada 1 vez
    E o pedido fica com status "PROCESSED"
    E o estoque de "Teclado" é 4
    E não há mensagem na fila "orders.dead"
    E existe exatamente 1 linha em "stock_reservations" para esse pedido

  @sem-retry @regra-de-negocio
  Cenário: Erro de negócio falha de imediato, sem retry e sem dead-letter
    Dado um pedido PENDING cujo estoque não cobre a quantidade pedida
    Quando o consumidor processa a mensagem
    Então o pedido fica com status "FAILED"
    E o campo "failure_code" é "INSUFFICIENT_STOCK"
    E foi observada exatamente 1 tentativa
    E não há mensagem na fila "orders.dead"

  @dlq-direto
  Cenário: Payload corrompido vai direto para a dead-letter
    Quando chega na fila "orders.created" uma mensagem com JSON inválido
    Então a mensagem vai para "orders.dead" sem nenhuma retentativa
    E um log de nível "error" é emitido com o event_id da mensagem
    E nenhum pedido é alterado

  @dlq-direto
  Cenário: Evento de um pedido que não existe no banco
    Quando chega um evento "order.created" para um orderId inexistente
    Então a mensagem vai para "orders.dead"
    E um log de nível "error" é emitido com o orderId
    E nenhuma linha é criada em "orders"

  @default-seguro
  Cenário: Erro desconhecido é tratado como transitório
    Dado um pedido PENDING de "Ana Souza" com 1 unidade de "Teclado"
    E que o processamento vai lançar um erro não catalogado
    Quando o consumidor processa a mensagem até esgotar as tentativas
    Então a mensagem foi retentada 3 vezes antes da dead-letter
    E o pedido fica com status "FAILED" com "RETRIES_EXHAUSTED"

  @dlq @operacao
  Cenário: A dead-letter preserva o que o plantão precisa
    Dado uma mensagem na fila "orders.dead"
    Então a mensagem carrega o header "x-attempt" com valor 4
    E carrega o header "x-correlation-id" do pedido original
    E carrega o header "x-death-reason" com a mensagem do último erro
    E o payload original está intacto
