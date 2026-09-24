# language: pt
@us-08 @b1 @api @bonus
Funcionalidade: Autenticação e autorização

  Como responsável pela API
  Quero exigir um JWT válido e checar o papel de quem chama
  Para que só operador consiga reprocessar pedido e só cliente autenticado crie pedido

  Estes cenários rodam DUAS vezes: contra o provedor local (HS256 sobre a tabela
  `users`) e contra o Keycloak (RS256 validado pelo JWKS). O comportamento
  descrito aqui é o contrato público da API, e ele não pode mudar quando o
  provedor de identidade muda — é exatamente isso que as duas execuções provam.

  Contexto:
    Dado os usuários semeados:
      | email               | senha      | papel    |
      | admin@loja.test     | admin123   | ADMIN    |
      | cliente@loja.test   | cliente123 | CUSTOMER |

  @login
  Cenário: Login válido devolve um JWT utilizável
    Quando eu envio "POST /auth/login" com "cliente@loja.test" e "cliente123"
    Então a resposta tem status 200
    E a resposta traz um "accessToken"
    E o token identifica o usuário, carrega o papel "CUSTOMER" e expira no futuro
    E o token não contém o hash da senha

  @login @falha
  Esquema do Cenário: Login inválido não diz o que estava errado
    Quando eu envio "POST /auth/login" com "<email>" e "<senha>"
    Então a resposta tem status 401
    E o campo "code" do corpo de erro é "INVALID_CREDENTIALS"
    E a mensagem é a mesma nos dois casos

    Exemplos:
      | email                | senha      | caso              |
      | cliente@loja.test    | errada     | senha errada      |
      | naoexiste@loja.test  | cliente123 | usuário inexistente |

  @protecao
  Esquema do Cenário: Endpoints protegidos exigem token
    Quando eu envio "<metodo> <rota>" sem token
    Então a resposta tem status 401
    E o campo "code" do corpo de erro é "UNAUTHORIZED"

    Exemplos:
      | metodo | rota                     |
      | POST   | /orders                  |
      | GET    | /orders                  |
      | GET    | /orders/{id}             |
      | POST   | /orders/{id}/reprocess   |

  @protecao @token
  Esquema do Cenário: Token inválido é recusado
    Quando eu envio "GET /orders" com um token <situacao>
    Então a resposta tem status 401

    Exemplos:
      | situacao                    |
      | expirado                    |
      | assinado com outro segredo  |
      | com o payload adulterado    |
      | malformado                  |

  @papel
  Cenário: Papel insuficiente é 403, não 401
    Dado que estou autenticado com o papel "CUSTOMER"
    Quando eu envio "POST /orders/{id}/reprocess" para um pedido "FAILED"
    Então a resposta tem status 403
    E o campo "code" do corpo de erro é "FORBIDDEN"

  @publico
  Esquema do Cenário: Rotas públicas continuam abertas
    Quando eu envio "GET <rota>" sem token
    Então a resposta tem status 200

    Exemplos:
      | rota           |
      | /health/live   |
      | /health/ready  |
      | /docs          |
