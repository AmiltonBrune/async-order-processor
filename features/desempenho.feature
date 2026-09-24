# language: pt
@us-12 @carga @k6
Funcionalidade: Desempenho e escala sob carga

  Como responsável pela operação
  Quero que a criação do pedido continue rápida mesmo com o worker saturado
  Para que um pico de processamento não vire indisponibilidade da API

  Esta feature tem dono próprio: os cenários são executados pelo **k6**, em
  `load/k6/`, por fora e via HTTP contra a stack em containers separados. Não
  há step definitions, e é deliberado — medir latência de dentro do processo
  que está sendo medido não mede coisa alguma, e um teste de carga precisa de
  rampa, taxa de chegada e limiares, que o harness de BDD não expressa.

  Os números medidos estão em `load/README.md`.

  @sincrono @critico
  Cenário: A criação do pedido não depende do broker nem do worker
    Dado 30 usuários criando pedidos simultaneamente por 70 segundos
    Então o percentil 95 de "POST /orders" fica abaixo de 300 ms
    E nenhuma requisição falha

  @desacoplamento @critico
  Cenário: Worker saturado não contamina a latência da API
    Dado uma taxa de chegada acima da capacidade de um consumidor
    Quando a fila começa a acumular
    Então o tempo até o pedido virar PROCESSED cresce
    Mas o percentil 95 de "POST /orders" continua abaixo de 300 ms

  @escala
  Cenário: Escalar o consumidor multiplica a vazão sem mudar código
    Dado a mesma taxa de chegada com 1 consumidor e depois com 3
    Então a vazão de processamento cresce com o número de consumidores
    E o tempo até PROCESSED volta ao patamar de base
    E nenhum pedido é perdido em nenhum dos dois cenários

  @overselling @obrigatorio
  Cenário: Sob carga real pela HTTP, o estoque continua exato
    Dado um estoque de 5 unidades e 40 pedidos HTTP simultâneos
    Quando todos são processados por consumidores concorrentes
    Então exatamente 5 pedidos ficam "PROCESSED"
    E os outros 35 ficam "FAILED" com "estoque insuficiente"
    E nenhum pedido continua "PENDING"
