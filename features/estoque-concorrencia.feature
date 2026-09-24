# language: pt
@us-05 @rn3 @rn4 @concorrencia @critico
Funcionalidade: Estoque sob concorrência

  Como dono do negócio
  Quero que o estoque nunca fique negativo, mesmo com pedidos simultâneos
  Para não vender o que eu não tenho e ter que cancelar depois

  Esta é a funcionalidade que o enunciado manda resolver, e ela tem dono próprio:
  os cenários daqui são implementados em `test/concurrency/`, não em step
  definitions. Cada um precisa de barreira de largada, pool de conexões
  dimensionado acima do paralelismo e repetição para não ser um teste que passa
  por sorte — controle que a camada de steps não dá sem virar gambiarra.

  As regras de reserva que valem para um pedido de cada vez estão em
  `estoque-reserva.feature`.

  Contexto:
    Dado o catálogo com os produtos:
      | nome    | preco | estoque |
      | Teclado | 10.00 | 5       |
      | Mouse   | 3.33  | 5       |

  @rn3 @obrigatorio
  Cenário: Dez pedidos simultâneos para um estoque de cinco
    Dado 10 pedidos PENDING de 1 unidade de "Teclado" cada
    Quando os 10 eventos são processados em paralelo com barreira de largada
    Então o estoque de "Teclado" é exatamente 0
    E o estoque de "Teclado" nunca foi negativo em nenhum instante
    E exatamente 5 pedidos estão "PROCESSED"
    E exatamente 5 pedidos estão "FAILED" com "INSUFFICIENT_STOCK"
    E a soma de "stock_reservations.quantity" é 5
    E existem exatamente 5 linhas em "stock_reservations"
    E nenhum pedido continua "PENDING"

  @rn3
  Cenário: Quantidades desiguais competindo pelo mesmo estoque
    Dado os pedidos PENDING para "Teclado":
      | pedido | quantidade |
      | A      | 3          |
      | B      | 3          |
      | C      | 2          |
    Quando os 3 eventos são processados em paralelo com barreira de largada
    Então o estoque de "Teclado" não é negativo
    E a soma das quantidades dos pedidos "PROCESSED" é menor ou igual a 5
    E todo pedido "FAILED" tem "failure_code" igual a "INSUFFICIENT_STOCK"
    E "estoque inicial" menos "soma dos PROCESSED" é igual ao estoque final

  @rn4 @idempotencia
  Cenário: Duas entregas simultâneas do mesmo evento
    Dado um pedido PENDING de "Ana Souza" com 2 unidades de "Teclado"
    Quando a mesma mensagem é entregue 2 vezes em paralelo a 2 consumidores
    Então o estoque de "Teclado" é 3
    E existe exatamente 1 linha em "stock_reservations" para esse pedido
    E exatamente 1 das execuções aplicou o decremento

  @deadlock
  Cenário: Pedidos com os mesmos produtos em ordem oposta não travam
    Dado um pedido "A" com 1 de "Teclado" e 1 de "Mouse"
    E um pedido "B" com 1 de "Mouse" e 1 de "Teclado"
    Quando os 2 eventos são processados em paralelo, repetidamente, por 50 rodadas
    Então nenhum pedido fica "PENDING" ao final
    E todo pedido está "PROCESSED" ou "FAILED" com motivo registrado
    E qualquer deadlock detectado foi tratado como erro transitório e retentado
