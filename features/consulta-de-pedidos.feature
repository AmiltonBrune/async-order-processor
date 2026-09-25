# language: pt
@us-03 @us-04 @rf3 @rf4 @api
Funcionalidade: Consulta de pedidos

  Como cliente da loja
  Quero consultar um pedido e listar os meus pedidos com paginação
  Para acompanhar em que estado cada compra está

  Contexto:
    Dado que estou autenticado com o papel "CUSTOMER"

  @happy-path
  Esquema do Cenário: Consulta por id devolve o status atual
    Dado um pedido de "Ana Souza" no status "<status>"
    Quando eu envio "GET /orders/{id}" para esse pedido
    Então a resposta tem status 200
    E o campo "status" da resposta é "<status>"
    E a resposta traz "customerName", "total", "items" e "createdAt"

    Exemplos:
      | status    |
      | PENDING   |
      | PROCESSED |
      | FAILED    |

  @falha
  Cenário: Pedido FAILED mostra o motivo
    Dado um pedido de "Ana Souza" no status "FAILED" com código "INSUFFICIENT_STOCK" e motivo "estoque insuficiente"
    Quando eu envio "GET /orders/{id}" para esse pedido
    Então o campo "failureCode" da resposta é "INSUFFICIENT_STOCK"
    E o campo "failureReason" da resposta é "estoque insuficiente"

  @validacao
  Esquema do Cenário: Id inexistente ou malformado
    Quando eu envio "GET /orders/<id>"
    Então a resposta tem status <status>
    E o campo "code" do corpo de erro é "<code>"

    Exemplos:
      | id                                   | status | code             |
      | 0192f3c0-0000-7000-8000-000000000000 | 404    | ORDER_NOT_FOUND  |
      | nao-e-um-uuid                        | 400    | VALIDATION_ERROR |

  @paginacao
  Cenário: Listagem pagina e traz os metadados
    Dado 12 pedidos criados em ordem
    Quando eu envio "GET /orders?page=1&limit=5"
    Então a resposta tem status 200
    E a lista tem 5 itens
    E "meta" é: page 1, limit 5, total 12, totalPages 3
    E os pedidos vêm do mais recente para o mais antigo

  @paginacao @borda
  Esquema do Cenário: Bordas da paginação
    Dado 12 pedidos criados em ordem
    Quando eu envio "GET /orders?page=<page>&limit=<limit>"
    Então a resposta tem status <status>
    E a lista tem <itens> itens

    Exemplos:
      | page | limit | status | itens | observacao                        |
      | 3    | 5     | 200    | 2     | última página parcial             |
      | 4    | 5     | 200    | 0     | além do fim, lista vazia e não 404|
      | 1    | 100   | 200    | 12    | limite máximo aceito              |
      | 1    | 101   | 400    | 0     | acima do teto de 100              |
      | 0    | 5     | 400    | 0     | page começa em 1                  |
      | -1   | 5     | 400    | 0     | page negativa                     |
      | 1    | 0     | 400    | 0     | limit mínimo é 1                  |
      | abc  | 5     | 400    | 0     | page não numérica                 |

  @filtro
  Cenário: Filtro por status
    Dado 3 pedidos "PROCESSED" e 2 pedidos "FAILED"
    Quando eu envio "GET /orders?status=FAILED&page=1&limit=10"
    Então a lista tem 2 itens
    E todos os itens da lista têm status "FAILED"
    E "meta.total" é 2

  @filtro @validacao
  Cenário: Status inválido no filtro
    Quando eu envio "GET /orders?status=BANANA"
    Então a resposta tem status 400
    E o campo "code" do corpo de erro é "VALIDATION_ERROR"

  @paginacao @padrao
  Cenário: Sem parâmetros, usa o padrão
    Dado 12 pedidos criados em ordem
    Quando eu envio "GET /orders"
    Então a resposta tem status 200
    E "meta" é: page 1, limit 20, total 12, totalPages 1

  @seguranca @isolamento
  Cenário: Cliente não enxerga pedido criado por outra identidade
    Dado um pedido criado pelo operador
    Quando eu envio "GET /orders/{id}" para esse pedido
    Então a resposta tem status 404
    E o campo "code" do corpo de erro é "ORDER_NOT_FOUND"

  @seguranca @isolamento
  Cenário: A listagem mostra só os pedidos de quem pediu
    Dado 2 pedidos meus e 3 criados pelo operador
    Quando eu envio "GET /orders?page=1&limit=50"
    Então a lista tem 2 itens
    E "meta.total" é 2

  @seguranca @isolamento
  Cenário: O operador ADMIN enxerga os pedidos de todos
    Dado 2 pedidos meus e 3 criados pelo operador
    E que me autentico como "ADMIN"
    Quando eu envio "GET /orders?page=1&limit=50"
    Então a lista tem 5 itens
    E "meta.total" é 5

