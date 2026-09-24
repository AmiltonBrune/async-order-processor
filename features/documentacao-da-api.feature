# language: pt
@us-13 @b4 @bonus
Funcionalidade: Documentação executável da API

  Como pessoa que vai integrar com esta API
  Quero abrir uma página e testar todos os endpoints
  Para não precisar ler o código para descobrir o contrato

  A documentação é gerada do próprio código. Isso importa porque documentação
  escrita à mão envelhece em silêncio: a rota muda, o texto não, e quem integra
  descobre pelo 404. Aqui, rota nova sem descrição quebra este cenário.

  @publico
  Cenário: A documentação é pública e não exige token
    Quando eu envio "GET /docs" sem token
    Então a resposta tem status 200

  @contrato @critico
  Cenário: Toda rota implementada está documentada
    Quando eu leio a especificação em "/docs-json"
    Então todas estas rotas aparecem documentadas:
      | metodo | rota                   |
      | POST   | /auth/login            |
      | POST   | /orders                |
      | GET    | /orders                |
      | GET    | /orders/{id}           |
      | POST   | /orders/{id}/reprocess |
      | GET    | /health/live           |
      | GET    | /health/ready          |
    E nenhuma rota documentada deixou de existir na aplicação

  @contrato
  Cenário: Cada resposta tem schema, não só um código
    Quando eu leio a especificação em "/docs-json"
    Então "POST /orders" documenta as respostas 201, 400, 401 e 422
    E o corpo de sucesso tem schema com "id", "status", "total" e "items"
    E o corpo de erro tem schema com "code", "message" e "correlationId"

  @usabilidade
  Cenário: Dá para testar sem inventar payload
    Quando eu leio a especificação em "/docs-json"
    Então "POST /auth/login" traz exemplos prontos de credenciais
    E "POST /orders" traz um exemplo de pedido válido
    E "POST /orders" traz um exemplo do cenário de estoque insuficiente

  @seguranca
  Cenário: A documentação declara o esquema de autenticação
    Quando eu leio a especificação em "/docs-json"
    Então existe um esquema de segurança "bearer" do tipo "http"
    E as rotas de pedido exigem esse esquema
    E as rotas de saúde não exigem
