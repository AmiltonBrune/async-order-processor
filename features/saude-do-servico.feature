# language: pt
@us-11 @operacao
Funcionalidade: Sinais de saúde do serviço

  Como responsável pela operação
  Quero que liveness e readiness respondam perguntas diferentes
  Para que uma instabilidade de dependência não reinicie containers saudáveis

  A distinção não é formalidade: liveness responde "o processo está vivo?" e,
  se ele checasse o banco, uma oscilação do MySQL reiniciaria toda a frota ao
  mesmo tempo — o health check viraria a causa do apagão. Readiness responde
  "dá para me mandar tráfego?", e aí sim depende de MySQL e RabbitMQ.

  @publico
  Cenário: Os dois endpoints são públicos
    Quando eu envio "GET /health/live" sem token
    Então a resposta tem status 200
    Quando eu envio "GET /health/ready" sem token
    Então a resposta tem status 200

  @liveness
  Cenário: Liveness não consulta dependência nenhuma
    Quando eu envio "GET /health/live"
    Então a resposta tem status 200
    E o corpo é exatamente o status "ok"
    E nenhuma dependência foi consultada

  @readiness
  Cenário: Readiness relata cada dependência por nome
    Quando eu envio "GET /health/ready"
    Então a resposta tem status 200
    E o corpo lista a dependência "mysql" como disponível
    E o corpo lista a dependência "rabbitmq" como disponível

  @readiness @falha
  Cenário: Uma dependência fora derruba o readiness, não o liveness
    Dado que a sonda de "rabbitmq" passou a falhar
    Quando eu envio "GET /health/ready"
    Então a resposta tem status 503
    E o corpo marca "rabbitmq" como indisponível
    Mas "GET /health/live" continua respondendo 200

  @readiness @sonda
  Cenário: Sonda que falha devolve indisponível, e não erro
    Dado que a sonda de "mysql" lança uma exceção ao ser consultada
    Quando eu envio "GET /health/ready"
    Então a resposta tem status 503
    E não há erro 500
