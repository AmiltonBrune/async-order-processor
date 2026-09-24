# Async Order Processor

Backend de pedidos com processamento assíncrono: a API aceita o pedido e responde
imediatamente; a validação e a reserva de estoque acontecem fora do caminho da
requisição, consumidas de uma fila real, com retentativa, dead-letter e proteção
contra *overselling* sob concorrência.

**Stack:** NestJS 11 · TypeScript estrito · MySQL 8 · TypeORM · RabbitMQ · Docker Compose · Jest

---

## Como rodar

Pré-requisito: Docker com Compose v2. Nada além disso.

```bash
docker compose up -d --wait
```

Um comando sobe MySQL, RabbitMQ, as migrations e os três papéis da aplicação
(`api`, `relay`, `consumer`). O `--wait` só retorna quando todos os *health
checks* estão verdes.

| Endereço | O que é |
|---|---|
| http://localhost:3000/docs | **Swagger — dá para testar todos os endpoints por aqui** |
| http://localhost:3000/health/ready | Readiness (checa MySQL e RabbitMQ) |
| http://localhost:15672 | UI do RabbitMQ (`orders` / `orders`) |

Portas ocupadas? Todas são configuráveis: `HTTP_PORT`, `MYSQL_PORT`,
`RABBITMQ_PORT`, `RABBITMQ_UI_PORT`. O `.env.example` documenta cada variável.

### Pelo Swagger, sem sair do navegador

Abra http://localhost:3000/docs e siga nesta ordem:

1. **`POST /auth/login`** → *Try it out* → escolha o exemplo **cliente** → *Execute*.
2. Copie o `accessToken` da resposta, clique em **Authorize** (cadeado, topo
   direito), cole e confirme. O token fica guardado mesmo se você recarregar.
3. **`POST /orders`** → o seletor de exemplos traz quatro cenários prontos:
   pedido válido, estoque insuficiente, gatilho de falha e produto inexistente.
4. **`GET /orders/{id}`** alguns segundos depois — o worker já concluiu.
5. Para **`POST /orders/{id}/reprocess`**, refaça o passo 1 com o exemplo
   **operador** (`admin@loja.test`): a rota exige papel `ADMIN`.

### Ou pelo terminal, em dois minutos

```bash
# 1. autentica (usuários semeados por migration)
TOKEN=$(curl -s -X POST localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"cliente@loja.test","password":"cliente123"}' | jq -r .accessToken)

# 2. cria o pedido — responde 201 PENDING na hora, sem falar com o broker
curl -s -X POST localhost:3000/orders \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"customerName":"Ana Souza","items":[
        {"productName":"Teclado Mecanico","quantity":2,"price":"249.90"},
        {"productName":"Mouse Sem Fio","quantity":3,"price":"89.90"}]}' | jq

# 3. segundos depois, o worker concluiu
curl -s localhost:3000/orders/<id> -H "authorization: Bearer $TOKEN" | jq '.status, .total'
#> "PROCESSED"
#> "769.50"
```

O roteiro completo — incluindo estoque insuficiente, o gatilho de falha e o
reprocessamento — está em [`requests/orders.http`](./requests/orders.http).

### Repor o estoque enquanto explora

O catálogo nasce com **5 unidades** de cada produto — o valor que o enunciado
sugere, e o que torna o cenário de concorrência demonstrável. Explorando o
Swagger, cinco acabam em poucos cliques: a partir daí todo pedido volta
`FAILED: estoque insuficiente`, que é o sistema **funcionando**, não quebrado.

```bash
npm run db:reset-stock   # repõe as 5 unidades, mantendo os pedidos já criados
npm run db:reset         # estado de fábrica: apaga o volume e roda as migrations de novo
```

### Ver o overselling sendo barrado

O catálogo nasce com 5 unidades de cada produto. Dez pedidos simultâneos de uma
unidade do mesmo produto:

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null -X POST localhost:3000/orders \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"customerName\":\"Cliente $i\",\"items\":[{\"productName\":\"Webcam Full HD\",\"quantity\":1,\"price\":\"199.99\"}]}" &
done; wait
```

Resultado, verificado nesta máquina: **estoque final exatamente 0, cinco pedidos
`PROCESSED`, cinco `FAILED` com `"estoque insuficiente"`, cinco reservas.** Nunca
negativo, em nenhum instante.

### Testes

```bash
npm install
npm run test:fast          # arquitetura + unitários — sem Docker, ~5 s

docker compose -f docker-compose.test.yml up -d --wait
npm run test:all           # tudo, contra MySQL e RabbitMQ reais
```

| Comando | Roda | Precisa de Docker |
|---|---|---|
| `npm run test:arch` | 48 asserções de arquitetura | não |
| `npm run test:unit` | 407 testes unitários | não |
| `npm run test:fast` | as duas acima (o loop do TDD) | não |
| `npm run test:bdd` | 13 features Gherkin, 110 casos | sim |
| `npm run test:int` | integração técnica | sim |
| `npm run test:concurrency` | paralelismo real | sim |
| `npm run test:all` | tudo, na ordem da pirâmide | sim |
| `npm run load:smoke` \| `load:create` \| `load:e2e` \| `load:oversell` | carga com k6, por fora, via HTTP | sim |

---

## Decisões de arquitetura

O desenho completo, com C4, ERD, máquinas de estado, diagramas de sequência e 16
ADRs, está em [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). As cinco decisões
que mais definem este código:

### 1. Outbox transacional — o pedido e o evento commitam juntos

`POST /orders` **não publica no broker**. Ele grava o pedido e a linha da outbox
na mesma transação; um processo separado (`relay`) drena a outbox para o RabbitMQ.

O problema que isso resolve é o *dual write*: gravar no banco e publicar na fila
são dois sistemas, e não existe jeito de fazer os dois atomicamente. Publicar
antes do commit gera evento de pedido que não existe; publicar depois perde o
evento se o processo morrer no meio. Com a outbox, o estado do banco é a única
fonte da verdade, e o pior caso vira *publicação duplicada* — que a idempotência
do consumidor absorve.

De brinde: o `POST` responde sem nenhuma ida de rede ao broker, que é o 201
imediato que o enunciado pede.

### 2. Decremento condicional atômico — a proteção contra overselling

```sql
UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty
```

A condição é avaliada pelo **próprio MySQL**, dentro do lock de linha que o
`UPDATE` adquire. Não existe janela entre "ler o estoque" e "decrementar" porque
não existe leitura: `affectedRows = 0` é a resposta de "não coube", e ela é
sempre verdadeira no instante em que foi dada.

Considerei e descartei:

- **Lock pessimista (`SELECT ... FOR UPDATE`)**: funciona, mas segura a linha do
  produto durante todo o processamento — inclusive durante o *sleep* de validação.
  A unidade de contenção passaria de microssegundos para segundos.
- **Lock otimista com `version`**: exige laço de retentativa na aplicação e, sob
  disputa alta pelo mesmo produto, degrada em *livelock*.
- **Verificar `canFulfill()` antes**: é a versão que parece certa e está errada.
  Entre a leitura e a escrita, outro worker leva a última unidade.

Sete das oito proteções de concorrência deste sistema são constraints do banco.
É deliberado: o MySQL é o único componente que enxerga todas as instâncias ao
mesmo tempo. Garantia em memória vale para um processo, e o cenário do enunciado
é de vários.

### 3. Três camadas de idempotência, e só a terceira é inegociável

| Camada | Pergunta | Mecanismo |
|---|---|---|
| 1 — mensagem | "já processei **esta entrega**?" | `inbox_messages (consumer, event_id)` |
| 2 — estado | "o pedido ainda está esperando?" | `UPDATE ... WHERE status='PENDING'` |
| 3 — efeito | "este pedido já reservou **este produto**?" | `UNIQUE (order_id, product_id)` |

As camadas 1 e 2 dependem de o código chamá-las na ordem certa. A 3 é uma
constraint: vale para o código que outra pessoa escrever daqui a seis meses sem
saber que a inbox existe. O reprocessamento manual atravessa 1 e 2 **de propósito**
— gera `event_id` novo e devolve o status para `PENDING` — e ainda assim não
consegue decrementar duas vezes.

### 4. Um binário, três papéis (`APP_ROLE`)

`api`, `relay` e `consumer` sobem do mesmo módulo e da mesma imagem. Três
binários separados divergem em silêncio: uma mudança no formato do evento chega
ao consumidor sem passar pelo produtor. Aqui isso não compila.

Escalar o consumo é `docker compose up -d --scale consumer=3`.

### 5. TypeORM usado como ORM, e SQL só onde ele é o artefato

Sete tabelas mapeadas com `EntitySchema`, `getRepository` para o acesso comum e
`createQueryBuilder` para o condicional. O SQL gerado é o mesmo de antes —
inclusive `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?` e
`FOR UPDATE SKIP LOCKED`, que o QueryBuilder expressa com `setLock` e
`setOnLocked`.

`EntitySchema` em vez de decorators porque decorator de ORM numa entidade de
domínio faria `src/domain/` importar `typeorm` — e o teste de fronteiras recusa.
O domínio continua sem saber que banco existe.

O mapeamento também tirou uma classe de erro do caminho: dinheiro vira `Money`
na leitura porque o `moneyTransformer` está na coluna, não porque cada
repositório lembrou de chamar `Money.of`.

SQL cru sobreviveu em dois lugares, e os dois são verificados: **migrations**
(lá o SQL é o artefato) e a **sonda de readiness** (`SELECT 1` é ping, não
leitura). Qualquer `.query(` num repositório quebra o CI.

### 6. Fronteiras verificadas por máquina

O enunciado diz: *"não vale chamar a lógica de processamento diretamente dentro do
controller"*. Isso é uma propriedade estrutural, e propriedade estrutural que só
vive na cabeça de quem escreveu apodrece no primeiro `import` apressado.

`test/architecture/` lê o grafo de importação de `src/` e falha apontando o
arquivo culpado — inclusive no caminho **transitivo** (`controller → helper →
publisher`). Verifica também ausência de arquivo prometido, ciclo de importação,
`synchronize: true`, dinheiro tipado como `number`, SQL fora da camada de
persistência e `.only` esquecido num teste. Roda em 1,5 s, sem Docker, antes de
qualquer serviço subir no CI.

---

## O que os testes provaram — e o que eles me obrigaram a mudar

São **615 testes** em cinco níveis, mais 4 cenários de carga em k6, ([`docs/TESTING.md`](./docs/TESTING.md) tem a
matriz completa). Três deles mudaram o código durante a implementação, e são os
mais interessantes de contar:

**1. A suíte de concorrência reprovou minha primeira ordem de operações.** Eu
tinha escrito *reservar e depois decrementar*, com o argumento de que a reentrega
seria detectada antes de qualquer efeito. Com dez pedidos simultâneos, o teste
devolveu **30 deadlocks**. O motivo: o `INSERT` em `stock_reservations` dispara a
verificação da FK e adquire lock **compartilhado** na linha do produto; as dez
transações seguram o S e todas pedem o X do `UPDATE` logo depois — ninguém sobe de
S para X, e o InnoDB mata as transações. Invertido para *decrementar e depois
reservar*, o `UPDATE` já toma o X e as outras simplesmente enfileiram. Zero
deadlock em 50 rodadas com produtos em ordem oposta.

**2. Um teste de arquitetura achou um teste que nunca rodava.** `health.e2e-spec.ts`
existia, estava documentado na matriz e **não era executado**: o padrão
`*.spec.ts` não casa com um nome cujo separador antes de `spec` é hífen. O
arquivo contava na revisão e não contava no CI. Corrigi o padrão e escrevi a
*fitness function* que vigia isso: todo arquivo de teste tem que ser alcançado
por algum projeto do Jest.

**3. A promessa de observabilidade estava vazia.** O cenário dizia "os logs da API
contêm o correlationId", e passava — porque na suíte os três papéis rodam no mesmo
processo, e as linhas do relay bastavam. No Docker, com processos separados, a API
não logava **nada** no caminho feliz. Acrescentei log por requisição e apertei a
asserção para exigir a linha da API especificamente. No caminho, um segundo bug:
o `tap` do RxJS dispara fora do escopo do `AsyncLocalStorage`, e a linha saía sem
o `correlationId` — o único campo que fazia ela existir.

---

## Desempenho medido

Números reais desta máquina, com a stack em containers ([`load/README.md`](./load/README.md)
tem a metodologia e o que eles não cobrem):

| | Resultado |
|---|---|
| `POST /orders` | **216 req/s**, p95 **203 ms**, 0 erro em 15.184 requisições |
| Pedido até `PROCESSED` | **1,93 s** em média (= *sleep* de 1,5 s + ciclo do relay) |
| Vazão do worker | **6,4 /s** com 1 consumidor · **14,1 /s** com 3 |
| Overselling sob 40 pedidos HTTP simultâneos, estoque 5 | **5 `PROCESSED`, 35 `FAILED`, 0 preso** |

A leitura que importa: com o worker saturado, a conclusão subiu de 2 s para 26 s
e o `POST` **continuou em 80 ms**. Se os dois subissem juntos, não haveria fila
de fato — só uma chamada síncrona disfarçada.

---

## Observabilidade: como eu investigaria de verdade

> *"Um cliente reclama que o pedido X ficou `PENDING` por 10 minutos."*

Todo log é JSON com `correlationId`, que nasce no `POST /orders` (ou vem do header
`x-correlation-id` do cliente), é gravado em `orders.correlation_id`, viaja no
payload do evento e no header AMQP, e reaparece em cada linha dos três processos.
O id volta no header da resposta — é o que o cliente cola no chamado.

```bash
docker compose logs api relay consumer | grep '"correlationId":"<id>"'
```

Saída real desta máquina, um id atravessando três containers:

```
api        04:49:57.303  Requisicao concluida
relay      04:49:57.662  Evento publicado
consumer   04:49:59.175  Mensagem processada
```

**A ausência é o diagnóstico.** Cada linha que falta aponta um culpado diferente:

| O que aparece | Onde parou | Próximo comando |
|---|---|---|
| só a linha da API | no relay: o evento está na outbox e não foi publicado | `SELECT status, attempts, last_error FROM outbox_messages WHERE aggregate_id = '<id>'` |
| API e relay, sem consumidor | no worker: publicado e não consumido | profundidade de `orders.created` na UI do RabbitMQ |
| os três, e o pedido segue `PENDING` | no processamento: caiu antes do commit | `SELECT * FROM inbox_messages WHERE order_id = '<id>'` e a fila `orders.dead` |

O `last_error` da outbox guarda o motivo real da falha de publicação; o
`failure_reason` do pedido guarda o motivo real da falha de processamento. Em
nenhum dos dois casos a resposta é "deu erro".

Senha, token e `authorization` são redigidos na origem — log que vaza segredo é
incidente de segurança disfarçado de observabilidade.

---

## O que eu faria diferente com mais tempo

Em ordem de quanto me incomoda:

1. **Preço não deveria vir do cliente.** O enunciado manda receber `price` em cada
   item, e eu obedeci — mas é manipulável, e o cliente poderia comprar por R$ 0,01.
   Em produção o valor viria de `products.price` no momento da criação, e o campo
   do payload seria no máximo um "preço esperado" usado para detectar catálogo
   desatualizado, devolvendo `409` na divergência. Está registrado no ADR-014.

2. **`outbox_messages` e `inbox_messages` crescem para sempre.** Em produção:
   job diário apagando linhas publicadas/processadas com mais de 30 dias, ou
   partição por data. Hoje a outbox só cresce, e o índice de despacho degrada
   junto com o histórico.

3. **Reserva de estoque não expira.** Uma reserva confirmada nunca é liberada. Um
   pedido cancelado deveria devolver o estoque (`UPDATE ... stock + qty` +
   `DELETE` da reserva, na mesma transação). O schema já suporta; o caso de uso
   não foi pedido.

4. **Relay por *polling*, não por CDC.** 500 ms de latência mínima e uma consulta
   por ciclo mesmo sem trabalho. Em escala, Debezium lendo o binlog elimina os dois.

5. **Sem métricas nem tracing distribuído.** Há log estruturado com correlation
   ID, suficiente para investigar caso a caso, mas não para ver tendência. O
   próximo passo é `prom-client` em `/metrics` (profundidade de fila, idade da
   mensagem mais antiga na outbox, taxa de `INSUFFICIENT_STOCK`) e OpenTelemetry
   com spans cruzando HTTP → outbox → AMQP → worker.

6. **O teste de carga não é um *stress test*.** O k6 mede a curva
   ([`load/README.md`](./load/README.md)), mas eu não empurrei até quebrar:
   não sei onde o MySQL satura nem a partir de quantos consumidores parar de
   ajudar. Com mais tempo: rampa até o erro, medindo profundidade de fila e
   conexões do pool.

7. **Paginação por offset.** Página alta degrada. O índice `(created_at, id)` já
   está pronto para cursor; a troca é direta quando o volume pedir.

8. **`GET /orders` lista tudo.** Com a autenticação entregue, o padrão deveria ser
   "cada cliente vê os seus", com listagem global apenas para `ADMIN`.

9. **Hash de senha com scrypt, não argon2.** argon2 é melhor, mas exige compilação
   nativa — e uma dependência que falha no `npm install` de quem avalia custa mais
   do que a diferença de resistência para um usuário de teste semeado. scrypt está
   na biblioteca padrão e é uma KDF adequada. Em produção com base real: argon2id.

---

## Documentação

| Documento | O que tem |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | C4, ERD, máquinas de estado, 8 diagramas de sequência, 16 ADRs, concorrência, idempotência |
| [`docs/USER_STORIES.md`](./docs/USER_STORIES.md) | 9 histórias com critérios de aceite e rastreabilidade |
| [`docs/TESTING.md`](./docs/TESTING.md) | O ciclo TDD, os cinco níveis e a matriz completa de testes |
| [`docs/PLAN.md`](./docs/PLAN.md) | A ordem de execução, fase a fase |
| [`RESPOSTAS.md`](./RESPOSTAS.md) | As cinco perguntas de arquitetura do enunciado |
| [`features/`](./features/) | 9 arquivos Gherkin em português, 82 casos executáveis |
| [`load/README.md`](./load/README.md) | Testes de carga com k6: metodologia, números medidos e o que eles não cobrem |

---

## Autenticação: local ou Keycloak

Dois provedores, um contrato. `AUTH_PROVIDER` escolhe qual sobe.

| | `local` (padrão) | `keycloak` |
|---|---|---|
| Emissão | tabela `users` + scrypt, JWT **HS256** | *password grant* no Keycloak, JWT **RS256** |
| Verificação | segredo compartilhado | chave pública do **JWKS**, em cache |
| Papéis | coluna `users.role` | claim `realm_access.roles`, filtrado por allowlist |
| Sobe em | instantâneo | ~30 s (container do Keycloak) |

```bash
docker compose up -d --wait     # local — rápido, sem dependência externa
npm run keycloak:up             # com Keycloak (console em http://localhost:8081, admin/admin)
```

Nos dois modos as credenciais são as mesmas (`cliente@loja.test` / `cliente123`,
`admin@loja.test` / `admin123`) e o Swagger funciona igual: `POST /auth/login`,
copie o `accessToken`, **Authorize**.

### Por que a troca custou duas classes

O ADR-016 prometia que trocar de provedor seria local. O sistema inteiro depende
de duas portas — `TokenVerifier` e `CredentialsAuthenticator` — e nenhum caso de
uso, controller ou guard sabe qual adaptador está no ar. A integração foi:
`KeycloakJwksVerifier`, `KeycloakCredentialsAuthenticator`, e três linhas de
seleção no `SecurityModule`. **Zero mudança em `src/application/` e em
`src/domain/`.**

Uma regra ficou deliberadamente **fora** do adaptador: "senha errada e usuário
inexistente devolvem a mesma resposta" vive no `LoginUseCase`. Se cada adaptador
decidisse a própria resposta, trocar de provedor mudaria o contrato da API sem
ninguém perceber — o Keycloak responde 401 para os dois casos, mas com corpos
diferentes.

### O que faz a API sobreviver ao SSO cair

Validar token **não chama o provedor**. A chave pública vem do JWKS uma vez e
fica no `JwksCache`, escrito à mão (~90 linhas, zero dependência) porque o que
importa aqui não é buscar a chave, é o que acontece quando o Keycloak não
responde:

- **Cache com TTL** — quem já tem token válido continua trabalhando. Só o login
  novo para.
- **Rate limit na renovação** — `kid` desconhecido dispara uma busca, no máximo
  uma por janela. Sem isso, tokens forjados com `kid` aleatório transformam esta
  API num amplificador de DDoS contra o Keycloak, de fora e de graça.
- **Chave velha servida se a renovação falhar** — soluço de rede não invalida uma
  chave RSA que continua boa.

Os três comportamentos têm teste (`jwks.cache.spec.ts`), e a integração inteira
é verificada contra um **Keycloak de verdade** em
`test/integration/keycloak-auth.e2e-spec.ts` — incluindo a recusa de um token
assinado por outro emissor. Detalhes na pergunta 4 do [`RESPOSTAS.md`](./RESPOSTAS.md).

### Em produção, este não seria o fluxo de login

O *Resource Owner Password Credentials* existe aqui para manter o Swagger
testável com um clique, sem redirecionamento — e está declarado como tal no
código. Com front-end de verdade, entra o *Authorization Code Flow with PKCE*: o
usuário digita a senha no Keycloak, nunca na nossa API. Isso troca **uma**
classe, `KeycloakCredentialsAuthenticator`, e nada mais.
