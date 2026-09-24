# language: pt
@us-10 @b1 @sso @bonus
Funcionalidade: Autenticação delegada a um provedor de identidade

  Como responsável pela API
  Quero delegar a identidade a um provedor de SSO sem mudar o contrato da API
  Para que trocar de provedor seja uma decisão de infraestrutura, não de produto

  `autenticacao.feature` descreve o contrato que vale para QUALQUER provedor, e
  por isso roda duas vezes — contra o local e contra o Keycloak. Esta feature
  descreve o que só existe no modo SSO: validação por chave pública, papéis
  vindos do provedor e o comportamento quando ele cai.

  Contexto:
    Dado que a API está configurada com o provedor "keycloak"
    E o realm "loja" importado com os usuários e papéis

  @critico
  Cenário: O token emitido pelo provedor abre a API
    Quando eu obtenho um token direto no provedor como "cliente@loja.test"
    Então o token é assinado em "RS256"
    E o emissor do token é o realm configurado
    Quando eu chamo "GET /orders" com esse token
    Então a resposta tem status 200

  @papeis
  Cenário: O papel vem do provedor, não de uma tabela local
    Quando eu obtenho um token direto no provedor como "admin@loja.test"
    Então o token carrega o papel "ADMIN" em "realm_access.roles"
    E esse papel autoriza "POST /orders/{id}/reprocess"

  @papeis @seguranca
  Cenário: Papel desconhecido do provedor não vira privilégio
    Dado um token cujo "realm_access.roles" contém "offline_access" e "CUSTOMER"
    Então a identidade reconhecida tem apenas o papel "CUSTOMER"
    E "offline_access" não aparece entre os papéis da aplicação

  @seguranca @critico
  Cenário: Token de outro emissor é recusado, mesmo com assinatura válida
    Dado um token válido cujo emissor foi trocado por outro realm
    Quando eu chamo "GET /orders" com esse token
    Então a resposta tem status 401

  @seguranca
  Cenário: Token assinado por chave fora do JWKS é recusado
    Dado um token RS256 assinado por uma chave que o provedor não publica
    Quando eu chamo "GET /orders" com esse token
    Então a resposta tem status 401

  @resiliencia @critico
  Cenário: O provedor fora do ar não derruba quem já tem token
    Dado que a chave pública do provedor já está em cache
    E que o provedor parou de responder
    Quando eu chamo "GET /orders" com um token válido emitido antes
    Então a resposta tem status 200
    E nenhuma chamada foi feita ao provedor durante a validação

  @resiliencia
  Cenário: Com o provedor fora, o login novo falha de forma honesta
    Dado que o provedor parou de responder
    Quando eu envio "POST /auth/login" com credenciais corretas
    Então a resposta NÃO é 401
    E o erro indica falha de infraestrutura, não credencial inválida
