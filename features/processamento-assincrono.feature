# language: pt
@us-02 @rf2 @worker
Funcionalidade: Processamento assíncrono do pedido

  Como operação da loja
  Quero que o pedido seja processado fora do ciclo da requisição
  Para que a API responda rápido e o processamento possa escalar sozinho

  O consumidor é o único lugar que decrementa estoque. Ele conclui o pedido
  em PROCESSED ou FAILED — nunca deixa em PENDING sem motivo registrado.

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |
      | Mouse   | 3.33  | 5       |

  @happy-path @critico
  Cenário: Pedido pendente vira PROCESSED e reserva o estoque
    Dado um pedido PENDING de "Ana Souza" com 2 unidades de "Teclado"
    E o evento "order.created" desse pedido publicado na fila
    Quando o consumidor processa a mensagem
    Então o pedido fica com status "PROCESSED"
    E o estoque de "Teclado" é 3
    E existe 1 linha em "stock_reservations" para esse pedido com quantidade 2
    E o campo "processed_at" do pedido está preenchido
    E os campos "failure_code" e "failure_reason" estão nulos

  @multi-item
  Cenário: Pedido com vários itens reserva todos ou nenhum
    Dado um pedido PENDING de "Ana Souza" com:
      | produto | quantidade |
      | Teclado | 2          |
      | Mouse   | 9          |
    Quando o consumidor processa a mensagem
    Então o pedido fica com status "FAILED"
    E o motivo salvo é "estoque insuficiente"
    E o estoque de "Teclado" continua 5
    E o estoque de "Mouse" continua 5
    E não existe nenhuma linha em "stock_reservations" para esse pedido

  @assincronia
  Cenário: O POST responde antes de o processamento terminar
    Quando eu envio um pedido válido de "Ana Souza"
    Então o pedido está "PENDING" no instante da resposta
    E em até 5 segundos o pedido está "PROCESSED"
    E a resposta do POST levou uma fração do tempo até a conclusão

  @desacoplamento @rt3
  Cenário: A criação não chama a lógica de processamento
    Quando eu envio um pedido válido de "Ana Souza" com o consumidor parado
    Então a resposta tem status 201
    E o pedido fica "PENDING" indefinidamente
    E o estoque de "Teclado" continua 5
    Quando o consumidor volta a rodar
    Então em até 5 segundos o pedido está "PROCESSED"

  @entrega @crash
  Cenário: Crash entre o COMMIT e o ack não duplica o efeito
    Dado um pedido PENDING de "Ana Souza" com 2 unidades de "Teclado"
    E que o consumidor vai morrer logo depois do COMMIT, antes do ack
    Quando o consumidor processa a mensagem e é reiniciado
    Então o estoque de "Teclado" é 3
    E existe exatamente 1 linha em "stock_reservations" para esse pedido
    E o pedido está "PROCESSED"
