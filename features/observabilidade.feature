# language: pt
@us-09 @b5 @observabilidade @bonus
Funcionalidade: Rastreabilidade de ponta a ponta

  Como pessoa de plantão
  Quero seguir um pedido pelo correlationId da API até o worker
  Para responder "por que o pedido X está PENDING há 10 minutos" sem adivinhar

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |

  @correlation-id @critico
  Cenário: O mesmo correlationId aparece nos três processos
    Quando eu envio um pedido válido de "Ana Souza"
    E o pedido é processado até "PROCESSED"
    Então os logs da API contêm o correlationId do pedido
    E os logs do relay contêm o mesmo correlationId
    E os logs do consumidor contêm o mesmo correlationId
    E a coluna "orders.correlation_id" tem esse mesmo valor
    E o payload do evento na outbox carrega esse mesmo valor
    E o header AMQP "x-correlation-id" da mensagem carrega esse mesmo valor

  @log-estruturado
  Cenário: Todo log é JSON com os campos de investigação
    Quando eu envio um pedido válido de "Ana Souza"
    Então cada linha de log é um JSON válido
    E cada linha tem os campos "level", "time", "msg" e "correlationId"
    E as linhas do processamento têm também "orderId"

  @investigacao
  Cenário: Pedido preso responde onde parou
    Dado um pedido PENDING criado há 10 minutos com o relay parado
    Quando eu consulto a outbox por esse pedido
    Então existe uma linha "PENDING" em "outbox_messages" com "attempts" maior que 0
    E o campo "last_error" explica por que a publicação não passou
    E a fila "orders.created" não tem mensagem para esse pedido

  @resposta-de-erro
  Cenário: Resposta de erro devolve o correlationId para o chamado de suporte
    Quando eu envio um pedido com um produto fora do catálogo
    Então a resposta tem status 422
    E o header "x-correlation-id" da resposta traz um identificador
    E o campo "correlationId" do corpo traz o mesmo identificador
    E os logs contêm esse mesmo identificador

  @seguranca
  Cenário: Log não vaza segredo
    Quando eu envio "POST /auth/login" com "cliente@loja.test" e "cliente123"
    Então nenhuma linha de log contém a senha
    E nenhuma linha de log contém o token emitido
    E o campo "authorization" aparece redigido nos logs
