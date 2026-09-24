# RESPOSTAS.md — Perguntas de arquitetura e sistemas

Respostas diretas às cinco perguntas do enunciado. Onde a resposta já está
implementada, aponto o arquivo; onde é projeto, digo que é projeto.

---

## 1. Como garantir que um evento não seja processado duas vezes em caso de reentrega?

**Aceitando que a reentrega vai acontecer e tornando o efeito idempotente** — não
tentando impedi-la. Entrega exatamente-uma-vez não existe em fila; o que existe é
entrega ao-menos-uma-vez com efeito exatamente-uma-vez.

Três camadas, cada uma respondendo a uma pergunta diferente:

| Camada | Pergunta | Mecanismo | Onde |
|---|---|---|---|
| 1 — mensagem | "já processei **esta entrega**?" | `PRIMARY KEY (consumer, event_id)` | `inbox.repository.ts` |
| 2 — estado | "o pedido ainda está esperando?" | `UPDATE ... WHERE id=? AND status='PENDING'`, checando `affectedRows` | `order.repository.ts` |
| 3 — efeito | "este pedido já reservou **este produto**?" | `UNIQUE (order_id, product_id)` | `stock.repository.ts` |

O `INSERT` na inbox é a **primeira** operação da transação do consumidor. Chave
duplicada significa reentrega: confirma a mensagem e encerra sem tocar em mais
nada. Como a inbox e o efeito commitam juntos, não existe o estado "registrei que
processei mas não processei".

**A camada 3 é a que não pode faltar.** As duas primeiras dependem de o código
chamá-las na ordem certa — e código muda. A terceira é uma constraint: vale
também para quem escrever um caso de uso novo daqui a seis meses sem saber que a
inbox existe. O reprocessamento manual prova isso: ele atravessa as camadas 1 e 2
**de propósito** (gera `event_id` novo, devolve o status para `PENDING`) e ainda
assim não consegue decrementar o estoque duas vezes.

A inbox é chaveada **por consumidor**, e não globalmente, para que um segundo
consumidor lógico (uma projeção, uma integração) possa processar o mesmo evento
sem que o primeiro o tenha "consumido" para todo mundo.

O `ack` é manual e acontece **depois** do commit. Um crash entre o commit e o
`ack` gera reentrega — que é exatamente o caso que as três camadas absorvem. O
contrário (ack antes) perderia o trabalho de vez, e mensagem confirmada não volta.

> Provado em `test/concurrency/idempotency.spec.ts` (a mesma mensagem entregue
> duas vezes em paralelo produz um decremento) e nos cenários `@rn4` de
> `features/estoque-reserva.feature`.

---

## 2. Como escalar o worker se o volume multiplicar por 10?

**Primeiro medir onde dói, depois escolher.** Multiplicar por 10 pode significar
três gargalos diferentes, e a resposta para cada um é distinta.

### Passo 1 — o que é barato e já está pronto

`docker compose up -d --scale consumer=5`. A arquitetura já suporta N consumidores
sem nenhuma coordenação externa: a inbox deduplica, o decremento condicional
serializa por linha de produto, e o `prefetch` distribui a carga. Os testes de
concorrência provam justamente que o resultado não depende de haver um worker só.

**Isto está medido, não estimado.** Com k6 empurrando 15 pedidos/s contra a
stack em containers ([`load/README.md`](./load/README.md)):

| | 1 consumidor | 3 consumidores |
|---|---:|---:|
| Vazão de processamento | 6,39 /s | **14,07 /s** |
| Conclusão ponta a ponta (avg) | 15,8 s | **1,95 s** |
| `POST /orders` p95 | 80 ms | 41 ms |

O teto de 6,39/s bate com a conta do desenho (`prefetch` 10 ÷ 1,5 s ≈ 6,7/s), e
triplicar o consumidor devolveu a latência ao patamar de base **sem uma linha de
código**. Note também que o `POST` ficou em 80 ms enquanto a conclusão foi a 26 s:
é o desacoplamento funcionando. Se os dois subissem juntos, não haveria fila.

Isso resolve o caso comum — **worker preso em I/O**, que é o perfil deste
processamento (`sleep` de validação, ida e volta ao MySQL).

### Passo 2 — o gargalo que a escala horizontal NÃO resolve

Se todos os pedidos disputam **o mesmo produto**, o `UPDATE` condicional serializa
por linha, e vinte workers esperam a mesma linha. Aumentar o número de consumidores
piora: mais conexões esperando o mesmo lock.

Aí o caminho é diferente:

- **Particionar por produto**: `exchange` por hash de `product_id`, cada fila com
  seu grupo de consumidores. Produtos diferentes deixam de esperar uns aos outros.
- **Agrupar decrementos**: em vez de um `UPDATE` por pedido, acumular numa janela
  curta e aplicar `stock - N` de uma vez. Ganha muito e custa previsibilidade —
  saber *quais* pedidos couberam fica mais difícil.

### Passo 3 — os limites que aparecem junto

| Limite | Sintoma | Resposta |
|---|---|---|
| Pool de conexões do MySQL | `ER_CON_COUNT_ERROR`, latência em escada | dimensionar `DB_POOL_SIZE` por réplica; acima de ~200 conexões, ProxySQL |
| Relay por *polling* | latência mínima de 500 ms independentemente da carga | aumentar `OUTBOX_BATCH_SIZE`; em escala, Debezium lendo o binlog |
| Fila `orders.created` crescendo | profundidade subindo de forma monotônica | é o sinal de alarme: consumo mais lento que produção |

### O que eu mediria antes de mexer

Profundidade da fila, **idade da mensagem mais antiga** (mais honesta que a
profundidade: 10 mil mensagens de 2 s é saudável, 50 mensagens de 10 min não é),
tempo de processamento p95 no worker e taxa de deadlock. Sem esses quatro números,
escalar é chute — e chute caro, porque worker a mais em gargalo de lock deixa tudo
mais lento.

---

## 3. Como migrar o schema em produção sem downtime?

**Expand / migrate / contract** — nunca uma migration que faz tudo de uma vez.

A regra que organiza tudo: **em nenhum instante o schema pode ser incompatível com
a versão da aplicação que está no ar.** Durante um deploy existem duas versões
rodando ao mesmo tempo, e o schema precisa servir as duas.

### As três fases

**1. Expand** — só adição, compatível com o código antigo.
Coluna nova é `NULL` ou tem `DEFAULT`; tabela nova não tem FK obrigatória para
tabela viva. O código antigo continua funcionando sem saber que a coluna existe.

**2. Migrate** — código novo escreve nos dois lugares.
Faz *dual write* (coluna antiga e nova) e lê da antiga. O backfill roda em lotes,
com pausa, para não travar réplica:

```sql
UPDATE orders SET novo = f(antigo)
 WHERE novo IS NULL AND id > :ultimo
 ORDER BY id LIMIT 1000;
```

Um lote grande demais é como uma migration derruba produção: `UPDATE` sem `LIMIT`
numa tabela de milhões segura lock e enche o *binlog*. Depois do backfill, o
código passa a ler da nova, ainda escrevendo nas duas — este é o ponto de
*rollback barato*, e ele deve durar pelo menos um ciclo de deploy.

**3. Contract** — remoção, num deploy **separado** e depois da janela de rollback.
Só então `DROP COLUMN`.

### O que eu nunca faria

- `ALTER TABLE` bloqueante em tabela grande no horário de pico. MySQL 8 faz muita
  coisa com `ALGORITHM=INPLACE, LOCK=NONE`, mas **não tudo** — mudar tipo de coluna
  e reordenar continuam copiando a tabela inteira. Quando for desse tipo:
  `gh-ost` ou `pt-online-schema-change`.
- Renomear coluna. Renomear é `DROP` + `ADD` disfarçado: quebra o código antigo no
  instante em que roda. Renomear é sempre expand/contract.
- `NOT NULL` sem `DEFAULT` numa coluna nova. O código antigo faz `INSERT` sem ela.
- Migration sem `down` testado. Sem rollback, a resposta a um problema às 3h da
  manhã é "escrever uma migration nova sob pressão".

### Neste projeto especificamente

`synchronize: false` em **todo** ambiente (ADR-008) — a conveniência de
sincronizar em desenvolvimento é o ensaio para o dia em que alguém sincroniza em
produção e perde uma coluna. As migrations rodam num container próprio que
executa e sai; os três papéis só sobem depois que ele termina com sucesso
(`depends_on: service_completed_successfully`), então nenhum processo sobe contra
um schema que ainda não existe.

`test/integration/schema-invariants.spec.ts` verifica que a migration produziu de
fato os `CHECK`, os índices compostos, a coluna gerada e as chaves únicas — uma
migration que "rodou" mas esqueceu `uq_stock_reservations_order_product` deixaria
o sistema funcionando perfeitamente até a primeira reentrega.

---

## 4. Se o provedor de SSO ficar indisponível, o que acontece e como mitigar?

**Com o desenho correto, quase nada acontece** — e é por isso que o desenho importa
mais que o plano de contingência.

### O que continua funcionando

Validar um JWT **não exige** chamar o provedor. A assinatura é verificada com a
chave pública, que vem do JWKS (`/.well-known/jwks.json`) e fica **em cache**.
Provedor fora do ar:

| Operação | Estado | Por quê |
|---|---|---|
| Requisições com token válido | ✅ funcionam | validação é local, com a chave em cache |
| Requisições com token expirado | ❌ 401 | correto: o token expirou mesmo |
| **Login novo** | ❌ indisponível | é o provedor que emite |
| Renovação de token | ❌ indisponível | idem |

Ou seja: **quem já está dentro continua trabalhando; quem precisa entrar, não
entra.** A degradação é parcial e previsível, e o raio de alcance é proporcional ao
tempo de vida do token.

### O erro clássico que transforma isso num apagão

Chamar o `/userinfo` do provedor **a cada requisição** para validar o token. Isso
troca uma verificação local de microssegundos por uma dependência de rede síncrona
no caminho crítico — e o provedor fora do ar derruba a API inteira, não só o login.
A aplicação nunca deve chamar o provedor por requisição.

### Mitigações, em ordem de custo

1. **Cache do JWKS com TTL longo e *stale-while-revalidate*.** Falha ao atualizar
   não invalida a chave antiga: serve a versão em cache e tenta de novo depois.
   Isto sozinho cobre a maior parte das quedas, que são curtas.
2. **Tolerância a rotação de chave.** Aceitar as chaves em cache por `kid`, e só
   buscar o JWKS quando aparecer um `kid` desconhecido — com *rate limit* na busca,
   para que token forjado com `kid` aleatório não vire DDoS no provedor.
3. **Tempo de vida de token deliberado.** Access token curto (15 min) é mais seguro
   e menos resiliente; longo é o inverso. Com refresh token, 15 min de access e
   refresh no provedor é o padrão — e nesse caso a queda começa a doer em 15 min.
4. **Health check separado.** `/health/ready` não deve depender do provedor: se
   dependesse, uma queda do SSO tiraria todos os containers do balanceador — com a
   API perfeitamente capaz de atender.
5. **Circuit breaker na emissão**, com mensagem honesta: "autenticação
   temporariamente indisponível, sessões ativas seguem funcionando". Repetir a
   chamada num provedor caído só aumenta a fila de conexões.
6. **Quebra-vidro**, se o negócio exigir: um caminho local para um punhado de
   contas de operação, com credencial em cofre, auditoria de todo uso e alarme
   automático. É risco de segurança assumido conscientemente — não se implementa
   "por via das dúvidas".

### Neste projeto — implementado, não descrito

O Keycloak **está integrado e testado**, não apenas comentado. `AUTH_PROVIDER`
escolhe entre `local` (HS256 com segredo compartilhado) e `keycloak` (RS256
contra o JWKS):

```bash
npm run keycloak:up   # sobe Keycloak com realm, client, papéis e usuários importados
```

A troca custou exatamente o que a porta prometia: duas classes novas
(`KeycloakJwksVerifier` e `KeycloakCredentialsAuthenticator`) e três linhas de
seleção no `SecurityModule`. **Nenhuma linha de `src/application/` ou
`src/domain/` mudou.**

As três mitigações da lista acima não são plano — são código com teste:

| Mitigação | Onde | Teste |
|---|---|---|
| Cache do JWKS: validar não chama o provedor | `jwks.cache.ts` | "NÃO chama o provedor a cada verificação" |
| *Stale-while-revalidate*: chave velha se a renovação falhar | idem | "serve a chave em cache quando a renovação falha" |
| Rate limit: `kid` forjado não vira DDoS | idem | "limita a renovação: kid forjado não vira DDoS" |
| Health check independente do SSO | `readiness.module.ts` | `/health/ready` só checa MySQL e RabbitMQ |
| Erro de infra não vira "senha inválida" | `login.use-case.ts` | "deixa erro de infraestrutura subir, em vez de virar 401" |

A integração ponta a ponta roda contra um **Keycloak de verdade** em
`test/integration/keycloak-auth.e2e-spec.ts`: token RS256 emitido pelo provedor,
papel lido do `realm_access`, e um token de outro emissor recusado. Validar
contra um JWKS mockado provaria que o mock funciona — não que a integração
funciona.

**Uma ressalva honesta sobre o fluxo de login.** Uso o *Resource Owner Password
Credentials* para manter o Swagger testável com um clique. Em produção com
front-end, o certo é o *Authorization Code Flow with PKCE*, em que a senha é
digitada no Keycloak e nunca chega na nossa API. Isso troca **uma** classe.

---

## 5. Um pedido ficou "travado". Como descobrir se o problema está na API, na fila ou no worker?

**Não se descobre: se lê.** O sistema foi construído para que essa pergunta tenha
uma resposta em um comando, e não uma investigação.

O `correlationId` nasce no `POST /orders` (ou vem do header `x-correlation-id` do
cliente), é gravado em `orders.correlation_id`, viaja no payload do evento e no
header AMQP, e reaparece em cada linha de log dos três processos. Ele volta no
header da resposta — é o que o cliente cola no chamado.

```bash
docker compose logs api relay consumer | grep '"correlationId":"<id>"'
```

Saída real, um id atravessando três containers:

```
api        04:49:57.303  Requisicao concluida
relay      04:49:57.662  Evento publicado
consumer   04:49:59.175  Mensagem processada
```

### A ausência é o diagnóstico

Cada linha que **falta** aponta um culpado diferente. É por isso que cada um dos
três papéis registra uma linha no caminho feliz — sem isso, "não tem log" seria
ambíguo entre "não passou por aqui" e "passou e não registrou".

| O que aparece | Onde parou | Como confirmar |
|---|---|---|
| **nada** | a requisição não chegou, ou nem foi feita | log do balanceador; `SELECT id FROM orders WHERE id = ?` |
| só a **API** | no relay: o evento está na outbox e não saiu | `SELECT status, attempts, last_error FROM outbox_messages WHERE aggregate_id = ?` |
| API + **relay** | no worker: publicado e não consumido | profundidade de `orders.created`; há consumidor ligado? |
| os três, pedido `PENDING` | o worker caiu antes do commit | `SELECT * FROM inbox_messages WHERE order_id = ?` e a fila `orders.dead` |
| os três, pedido `FAILED` | não travou: terminou mal | `SELECT failure_code, failure_reason FROM orders WHERE id = ?` |

### As três consultas que respondem quase tudo

```sql
-- 1. O que o pedido diz de si mesmo
SELECT status, failure_code, failure_reason, processing_attempts, correlation_id,
       created_at, processed_at
  FROM orders WHERE id = ?;

-- 2. O evento saiu? Se não, por quê? (`last_error` guarda o motivo REAL)
SELECT status, attempts, last_error, available_at, published_at
  FROM outbox_messages WHERE aggregate_id = ?;

-- 3. Algum consumidor chegou a registrar esta entrega?
SELECT consumer, event_id, processed_at FROM inbox_messages WHERE order_id = ?;
```

Mais a UI do RabbitMQ em `localhost:15672`: profundidade de `orders.created`,
mensagens paradas nos degraus de espera e o conteúdo de `orders.dead` — que
carrega `x-attempt`, `x-correlation-id` e `x-death-reason` com a mensagem do
último erro.

### Os quatro cenários reais, e o que cada um parece

| Sintoma | Causa provável | Onde aparece |
|---|---|---|
| `outbox_messages` `PENDING` com `attempts > 0` | broker fora do ar ou credencial errada | `last_error` da linha |
| `outbox_messages` `PENDING` com `attempts = 0` e antiga | **relay parado** | processo do relay; `countPending` subindo |
| mensagem na fila, `inbox_messages` vazia | **consumidor parado** ou em *crash loop* | profundidade da fila + log do consumer |
| `inbox_messages` preenchida, pedido `PENDING` | crash entre o `INSERT` da inbox e o commit | é impossível: as duas commitam juntas. Se acontecer, é bug — e um bug que eu quero ver |

### O que falta aqui, e eu reconheço

Log estruturado com correlation ID responde **caso a caso**. Não responde
"começou quando?" nem "quantos pedidos estão assim?". Para isso faltam métricas
(`prom-client` em `/metrics`: profundidade de fila, **idade da mensagem mais
antiga na outbox**, taxa de `INSUFFICIENT_STOCK`, deadlocks por minuto) e tracing
distribuído (OpenTelemetry com spans cruzando HTTP → outbox → AMQP → worker).

A métrica que eu colocaria primeiro, se pudesse escolher uma: **idade da mensagem
`PENDING` mais antiga na outbox.** Ela detecta relay parado, broker fora e pico de
carga — os três antes de o cliente ligar.
