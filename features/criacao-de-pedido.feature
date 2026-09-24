# language: pt
@us-01 @rf1 @api
Funcionalidade: Criação de pedido

  Como cliente da loja
  Quero registrar um pedido e receber a confirmação na hora
  Para não ficar preso esperando a validação de estoque dentro da requisição

  Princípio desta funcionalidade: o POST **não** valida estoque e **não**
  fala com o broker. Ele grava pedido e evento na mesma transação e responde.

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |
      | Mouse   | 3.33  | 5       |
    E que estou autenticado com o papel "CUSTOMER"

  @happy-path
  Cenário: Pedido com dois itens calcula o total e nasce PENDING
    Quando eu envio "POST /orders" com o corpo:
      """
      {
        "customerName": "Ana Souza",
        "items": [
          { "productName": "Teclado", "quantity": 2, "price": "10.00" },
          { "productName": "Mouse",   "quantity": 3, "price": "3.33"  }
        ]
      }
      """
    Então a resposta tem status 201
    E o campo "status" da resposta é "PENDING"
    E o campo "total" da resposta é "29.99"
    E o pedido devolvido existe na tabela "orders" com status "PENDING"
    E a tabela "order_items" tem 2 linhas para esse pedido
    E a resposta traz o header "x-correlation-id"

  @dual-write @b3 @critico
  Cenário: Pedido e evento nascem na mesma transação
    Quando eu envio um pedido válido de "Ana Souza"
    Então existe exatamente 1 linha em "outbox_messages" com event_name "order.created"
    E essa linha está com status "PENDING"
    E o "correlationId" do payload é igual ao "correlation_id" do pedido
    E o evento é versionado, com "eventName" e "version" explícitos

  @dual-write @critico @falha
  Cenário: Falha ao gravar o evento não pode deixar pedido órfão
    Dado que o INSERT em "outbox_messages" vai falhar
    Quando eu envio um pedido válido de "Ana Souza"
    Então a resposta tem status 500
    E a tabela "orders" continua vazia
    E a tabela "order_items" continua vazia

  @dinheiro
  Esquema do Cenário: O total é somado em decimal, nunca em ponto flutuante
    Quando eu envio um pedido com um item "<produto>" de quantidade <qtd> e preço "<preco>"
    Então o campo "total" da resposta é "<total>"

    Exemplos:
      | produto | qtd | preco      | total      |
      | Teclado | 3   | 0.10       | 0.30       |
      | Teclado | 1   | 0.01       | 0.01       |
      | Mouse   | 7   | 3.33       | 23.31      |
      | Teclado | 2   | 4999999.99 | 9999999.98 |

  @validacao
  Esquema do Cenário: Entrada inválida é recusada antes de tocar no banco
    Quando eu envio "POST /orders" com <entrada_invalida>
    Então a resposta tem status <status>
    E o campo "code" do corpo de erro é "<code>"
    E a tabela "orders" continua vazia

    Exemplos:
      | entrada_invalida                     | status | code                 |
      | lista de itens vazia                 | 400    | VALIDATION_ERROR     |
      | um item com quantidade 0             | 400    | VALIDATION_ERROR     |
      | um item com quantidade negativa      | 400    | VALIDATION_ERROR     |
      | um item com preço negativo           | 400    | VALIDATION_ERROR     |
      | customerName vazio                   | 400    | VALIDATION_ERROR     |
      | customerName com 300 caracteres      | 400    | VALIDATION_ERROR     |
      | um produto que não existe no catálogo| 422    | PRODUCT_NOT_FOUND    |

  @observabilidade
  Cenário: O correlation ID enviado pelo cliente é respeitado
    Quando eu envio um pedido válido com o header "x-correlation-id" igual a "11111111-1111-7111-8111-111111111111"
    Então a resposta traz o mesmo "x-correlation-id"
    E o pedido gravado tem "correlation_id" igual a "11111111-1111-7111-8111-111111111111"
    E o payload do evento na outbox carrega esse mesmo correlationId
