# Testes de carga (k6)

Quatro cenários, cada um respondendo uma pergunta diferente. Todos rodam **por
fora**, via HTTP, contra a stack em containers separados — é a única camada de
teste deste projeto que enxerga a API, o relay e o worker como três processos de
verdade, e não como um processo só com três papéis.

```bash
docker compose up -d --wait

npm run load:smoke       # 1 usuário, fluxo completo — valida o ambiente
npm run load:create      # carga no POST /orders (caminho síncrono)
npm run load:e2e         # carga no caminho completo, até PROCESSED
npm run load:oversell    # o cenário do enunciado, sob carga, pela HTTP
```

`load/prep.sh` roda antes de cada cenário: limpa o banco, **purga as filas do
broker** e repõe o estoque. Limpar só o banco não basta — as mensagens já
publicadas continuam no RabbitMQ, o worker as processa, não acha o pedido e as
manda para a dead-letter. Isso está correto, mas consome a vazão do worker e
coloca os pedidos novos atrás de milhares de mensagens órfãs. A primeira rodada
que eu fiz mediu exatamente isso: fila represada em vez de latência.

---

## Resultados medidos

Máquina de desenvolvimento, Docker Compose local, MySQL 8 e RabbitMQ 3.13 em
containers. Não são números de produção — são o formato da curva.

### 1. Caminho síncrono — `POST /orders`

30 VUs em rampa, 70 s.

| Métrica | Valor |
|---|---|
| Vazão | **216 req/s** |
| Latência p95 | **203 ms** |
| Latência mediana | 110 ms |
| Erros | **0** em 15.184 requisições |
| Checks | 100% |

É o número que a arquitetura promete: o `POST` não fala com o broker, só grava
duas linhas numa transação. Se algum dia alguém enfiar uma chamada de rede aqui,
o *threshold* de 300 ms no p95 quebra o CI.

### 2. Caminho completo — até o pedido virar `PROCESSED`

5 pedidos/s por 30 s, 1 consumidor.

| Métrica | Valor |
|---|---|
| Conclusão ponta a ponta (avg) | **1,93 s** |
| Conclusão p95 | 2,11 s |
| `POST` p95 | 28 ms |
| Pedidos presos em PENDING | **0** |

1,93 s é a soma honesta da cadeia: `PROCESSING_DELAY_MS` (1,5 s, o *sleep* que o
enunciado pede) + o ciclo de *polling* do relay (até 500 ms) + a travessia.

### 3. Saturação e escala horizontal

O mesmo cenário a **15 pedidos/s**, acima da capacidade de um worker:

| | 1 consumidor | 3 consumidores |
|---|---:|---:|
| Vazão de processamento | **6,39 /s** | **14,07 /s** |
| Conclusão ponta a ponta (avg) | 15,8 s | **1,95 s** |
| Conclusão p95 | 26,2 s | **2,19 s** |
| `POST /orders` p95 | 80 ms | 41 ms |
| Pedidos perdidos | 0 | 0 |

**Duas leituras que valem mais que os números.**

A primeira: com o worker saturado, a conclusão foi de 2 s para 26 s e o `POST`
continuou em 80 ms. É o desacoplamento funcionando — se os dois subissem juntos,
não haveria fila de fato, só uma chamada síncrona disfarçada.

A segunda: 6,39/s bate com a conta do desenho (`prefetch` 10 ÷ 1,5 s de
processamento ≈ 6,7/s). Triplicar o consumidor multiplicou a vazão por 2,2 e
devolveu a latência ao patamar de base, sem nenhuma mudança de código —
`docker compose up -d --scale consumer=3`. É a resposta da pergunta 2 do
`RESPOSTAS.md`, agora com medida em vez de estimativa.

### 4. Overselling sob carga, pela HTTP

40 pedidos simultâneos de 1 unidade, estoque **5**, 3 consumidores concorrentes:

```
estoque inicial declarado : 5
pedidos enviados          : 40
PROCESSED                 : 5     ← exatamente o estoque, nunca mais
FAILED                    : 35    ← todos com "estoque insuficiente"
PENDING restantes         : 0     ← nenhum pedido perdido
```

Este cenário existe apesar de `test/concurrency/oversell.spec.ts` já provar o
mesmo — e a diferença é o ponto. O teste em processo usa barreira de largada e
garante simultaneidade; este não controla nada e atravessa pool de conexões,
número de consumidores e `prefetch` reais. Ele pode encontrar um modo de falha
que o outro não alcança.

---

## O que estes testes **não** cobrem

- **Não são um *stress test*.** Não empurrei até quebrar, então não sei onde o
  MySQL satura nem quantos consumidores param de ajudar. Com mais tempo: rampa
  até erro, medindo profundidade de fila e conexões do pool.
- **Não medem o relay isoladamente.** A latência dele aparece diluída na
  conclusão ponta a ponta. Uma métrica de *idade da mensagem PENDING mais antiga
  na outbox* diria isso direto — é a primeira métrica que eu instrumentaria.
- **Máquina única.** API, banco, broker e gerador de carga disputam a mesma CPU.
  Os números absolutos têm pouco valor; a comparação entre cenários tem.
