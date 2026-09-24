# USER_STORIES.md — Histórias e critérios de aceite

O enunciado está escrito em requisitos (`RF1`, `RN3`, `RT4`). Este documento
traduz cada um para a pergunta que interessa antes de escrever código: **quem
ganha o quê, e como eu sei que ficou pronto?**

Cada história aponta para o arquivo `.feature` que a torna executável. A regra é
simples: **nenhuma história é implementada antes de existir o cenário Gherkin
dela**, e nenhum cenário Gherkin entra sem a asserção que falharia se o bug
existisse. O ciclo de desenvolvimento está em [`TESTING.md`](./TESTING.md); o
desenho técnico, em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Personas

| Persona | Quem é | O que ela não tolera |
|---|---|---|
| **Cliente** | quem cria e acompanha o próprio pedido | esperar a API e não saber em que pé está o pedido |
| **Operador** | quem cuida da loja no dia a dia | pedido preso sem explicação; ter que mexer no banco na mão |
| **Plantão** | quem é acordado às 3h da manhã | investigar sem correlation ID; fila entupida sem sinal |
| **Dono do negócio** | quem responde pelo estoque e pelo caixa | vender o que não tem e cancelar depois |
| **Responsável pela API** | quem decide autenticação e contratos | ficar refém de um provedor de identidade |

---

## 2. Mapa de rastreabilidade

| História | Requisito | Feature | Fase do PLAN | Teste decisivo |
|---|---|---|---|---|
| US-01 Criar pedido | RF1 | `criacao-de-pedido.feature` | F2, F3 | `criacao-de-pedido.steps.spec.ts` |
| US-02 Processar assíncrono | RF2, RT3 | `processamento-assincrono.feature` | F5 | `processamento-assincrono.steps.spec.ts` |
| US-03 Consultar pedido | RF3 | `consulta-de-pedidos.feature` | F8 | `consulta-de-pedidos.steps.spec.ts` |
| US-04 Listar com paginação | RF4 | `consulta-de-pedidos.feature` | F8 | `consulta-de-pedidos.steps.spec.ts` |
| US-05 Reservar estoque sem vender a mais | RN1, RN2, RN4 | `estoque-reserva.feature` | F5, F6 | `estoque-reserva.steps.spec.ts` |
| US-05 … sob concorrência | RN3, RN4 | `estoque-concorrencia.feature` | F11 | `oversell.spec.ts` |
| US-06 Retentar e isolar veneno | RF5 | `retry-e-dead-letter.feature` | F7 | `retry-e-dead-letter.steps.spec.ts` |
| US-07 Reprocessar pedido FAILED | B2 | `reprocessamento-manual.feature` | F9 | `reprocessamento-manual.steps.spec.ts` |
| US-08 Proteger a API | B1 | `autenticacao.feature` (roda **2×**: local e SSO) | F14 | `autenticacao.steps.spec.ts` · `autenticacao-keycloak.steps.spec.ts` |
| US-09 Investigar sem adivinhar | B5 | `observabilidade.feature` | F10 | `observabilidade.steps.spec.ts` |
| US-10 Delegar identidade a um SSO | B1 | `autenticacao-sso.feature` | F15 | `autenticacao-sso.steps.spec.ts` |
| US-11 Sinalizar saúde para a operação | RT5 | `saude-do-servico.feature` | F0 | `saude-do-servico.steps.spec.ts` |
| US-12 Aguentar carga sem travar a API | — | `desempenho.feature` | F16 | `load/k6/` |
| US-13 Integrar sem ler o código | B4 | `documentacao-da-api.feature` | F12 | `documentacao-da-api.steps.spec.ts` |

---

## US-01 — Criar pedido sem esperar o estoque

> **Como** cliente da loja
> **quero** registrar meu pedido e receber a confirmação na hora
> **para** não ficar preso numa tela de carregamento enquanto o sistema confere estoque.

**Valor.** É o requisito que justifica a arquitetura inteira: se o `POST` pudesse
bloquear, não haveria fila, worker nem outbox.

**Critérios de aceite**

- [ ] `POST /orders` com `customerName` e `items[{productName, quantity, price}]` responde **201**.
- [ ] O total é a soma de `price × quantity`, em decimal — `0.10 × 3` devolve `0.30`, não `0.30000000000000004`.
- [ ] O pedido nasce com `status: PENDING`.
- [ ] O evento `order.created` é gravado **na mesma transação** do pedido.
- [ ] A resposta não espera nenhuma chamada de rede ao broker.
- [ ] Entrada inválida devolve 400 com corpo de erro padronizado, sem gravar nada.
- [ ] Produto fora do catálogo devolve 422 — validar **existência** não é validar **estoque**.

**Fora de escopo.** Verificar disponibilidade de estoque. Isso é US-05, e acontece
no worker, por exigência explícita do enunciado.

**Conversa técnica registrada.** O `price` vem do cliente porque o enunciado manda.
Em produção viria do catálogo — ver ADR-014.

---

## US-02 — Processar o pedido fora do ciclo da requisição

> **Como** operação da loja
> **quero** que o processamento aconteça num worker separado
> **para** que a API continue rápida e o processamento escale sozinho.

**Critérios de aceite**

- [ ] Um consumidor escuta `order.created` e conclui o pedido em `PROCESSED` ou `FAILED`.
- [ ] Nenhum pedido fica `PENDING` para sempre sem motivo registrado em algum lugar.
- [ ] Com o consumidor **parado**, o `POST` continua respondendo 201 — desacoplamento real.
- [ ] Com o consumidor de volta, o pedido parado é processado sem intervenção.
- [ ] O `ack` é manual e acontece **depois** do commit no MySQL.
- [ ] Crash entre o commit e o `ack` não duplica efeito (ver US-05).

**Prova de que o enunciado foi obedecido (RT3).** O controller não importa nada de
`infrastructure/messaging`, nem direta nem transitivamente — verificado em
`layer-boundaries.spec.ts`, não na revisão de código.

---

## US-03 — Consultar um pedido

> **Como** cliente
> **quero** consultar um pedido pelo id
> **para** saber se ele foi confirmado, e por que não foi, quando não foi.

**Critérios de aceite**

- [ ] `GET /orders/:id` devolve 200 com `status`, `total`, `items`, `createdAt`.
- [ ] Pedido `FAILED` devolve também `failureCode` e `failureReason`.
- [ ] Id inexistente devolve 404 tipado (`ORDER_NOT_FOUND`), não 500.
- [ ] Id malformado devolve 400, não 404 — o erro é do cliente, e é diferente.

---

## US-04 — Listar pedidos com paginação

> **Como** cliente
> **quero** listar meus pedidos em páginas
> **para** não receber um payload de dez mil linhas.

**Critérios de aceite**

- [ ] `GET /orders?page=&limit=` devolve `data` e `meta: { page, limit, total, totalPages }`.
- [ ] Sem parâmetros, usa `page=1, limit=20`.
- [ ] `limit` acima de 100 devolve 400 — teto declarado, não silenciosamente truncado.
- [ ] Página além do fim devolve lista vazia com 200, não 404.
- [ ] Última página parcial devolve o resto certo.
- [ ] `status` inválido no filtro devolve 400.
- [ ] Ordenação estável (`created_at, id`), servida por índice.

**Limitação assumida.** Paginação por offset degrada em página alta — ADR-010.

---

## US-05 — Reservar estoque sem nunca vender a mais

> **Como** dono do negócio
> **quero** que o estoque nunca fique negativo, mesmo com pedidos simultâneos
> **para** não ter que cancelar pedido já confirmado para o cliente.

**Esta é a história que o enunciado manda resolver.** As outras são o contexto
em que ela acontece.

Ela está escrita em dois `.feature`, porque os cenários têm donos diferentes:
`estoque-reserva.feature` (um pedido por vez, executado pelos step definitions) e
`estoque-concorrencia.feature` (paralelismo real, executado por `test/concurrency/`).
O critério da divisão está em `TESTING.md` §5.

**Critérios de aceite**

- [ ] O worker reserva o estoque **antes** de marcar `PROCESSED`.
- [ ] Sem estoque suficiente, o pedido vira `FAILED` com motivo `"estoque insuficiente"`.
- [ ] Um pedido reprovado **não** altera o estoque e **não** deixa reserva órfã.
- [ ] Com 10 pedidos de 1 unidade e `stock = 5`: exatamente 5 `PROCESSED`, 5 `FAILED`, estoque final `0`.
- [ ] O estoque nunca é negativo — nem por um instante, nem por bug futuro (`CHECK` no banco).
- [ ] Reentrega da mesma mensagem **não** decrementa duas vezes.
- [ ] Duas entregas simultâneas do mesmo evento: apenas uma aplica o decremento.
- [ ] Pedido multi-item é tudo-ou-nada: falhar no segundo item não deixa o primeiro reservado.
- [ ] Deadlock entre pedidos com produtos em ordem oposta é tratado como transitório e retentado.

**Estratégia escolhida e por quê.** Decremento condicional atômico
(`UPDATE ... WHERE stock >= :qty`, checando `affectedRows`) + reserva materializada
com `UNIQUE(order_id, product_id)`. O banco é o único componente que enxerga todas
as instâncias ao mesmo tempo; qualquer garantia guardada em memória vale para um
processo só, e o cenário do enunciado é de vários. Detalhe e alternativas
descartadas em ADR-002 e ADR-003.

---

## US-06 — Retentar o que é passageiro, isolar o que é veneno

> **Como** pessoa de plantão
> **quero** que erro transitório seja retentado e erro persistente vá para uma fila morta
> **para** não perder pedido e não segurar uma mensagem envenenada para sempre.

**Critérios de aceite**

- [ ] Erro transitório é retentado 3 vezes, com backoff 5s → 15s → 45s.
- [ ] Esgotadas as tentativas: pedido `FAILED` com `RETRIES_EXHAUSTED` e a **mensagem real do erro** salva em `failure_reason`, e cópia da mensagem em `orders.dead`.
- [ ] Erro de **negócio** (estoque insuficiente, produto inexistente) falha na primeira tentativa, sem retry e sem dead-letter — retentar não muda o resultado.
- [ ] `customerName` contendo `"fail"` exercita o caminho transitório completo (gatilho do enunciado).
- [ ] Payload corrompido vai direto para a dead-letter, com log de erro.
- [ ] Erro desconhecido é tratado como transitório — o default é o seguro.
- [ ] A mensagem na dead-letter carrega `x-attempt`, `x-correlation-id` e o motivo.

**Decisão registrada.** O gatilho `"fail"` foi classificado como transitório de
propósito: é o único caminho que exercita retry + TTL + dead-letter de ponta a
ponta. Como erro de negócio, o requisito 5 do enunciado ficaria sem prova.

---

## US-07 — Reprocessar um pedido que falhou

> **Como** operador
> **quero** reenfileirar um pedido `FAILED`
> **para** resolver o caso do cliente depois que a causa da falha foi corrigida.

**Critérios de aceite**

- [ ] `POST /orders/:id/reprocess` devolve 202 e devolve o pedido para `PENDING`.
- [ ] Só funciona a partir de `FAILED`; `PENDING` ou `PROCESSED` devolvem 409.
- [ ] Gera um **novo** `event_id` na outbox — atravessa a inbox de propósito.
- [ ] Limpa `failure_code` e `failure_reason`.
- [ ] Dois cliques simultâneos: exatamente um 202 e um 409.
- [ ] Mesmo reprocessando, o estoque **não** é decrementado duas vezes para o mesmo pedido.
- [ ] Exige papel `ADMIN` (quando US-08 estiver entregue).

**A sutileza que vale explicar na conversa técnica.** Reprocessar precisa furar
duas das três camadas de idempotência (inbox e checagem de estado) e mesmo assim
não pode furar a terceira. Por isso a terceira é uma constraint do banco, e não
uma condição em código.

---

## US-08 — Proteger a API (bônus)

> **Como** responsável pela API
> **quero** exigir JWT válido e checar papel
> **para** que só operador reprocesse pedido.

**Critérios de aceite**

- [ ] `POST /auth/login` devolve `accessToken` assinado, com `sub`, `role` e `exp`.
- [ ] Credencial errada e usuário inexistente devolvem **a mesma** mensagem — não vazar quais e-mails existem.
- [ ] Endpoints de pedido exigem token; sem token é 401.
- [ ] Token expirado, adulterado ou assinado com outro segredo é 401.
- [ ] Papel insuficiente é **403**, não 401 — autenticado ≠ autorizado.
- [ ] `/health/*` e `/docs` continuam públicos.
- [ ] Senha e token nunca aparecem em log.

**Troca por SSO: implementada, não descrita.** Ver US-10. O contrato desta
história vale igual nos dois provedores, e é por isso que `autenticacao.feature`
roda **duas vezes** — uma contra o local, uma contra o Keycloak. Se a troca de
provedor mudasse qualquer resposta desta lista, a segunda execução quebraria.

---

## US-09 — Investigar sem adivinhar (bônus)

> **Como** plantão
> **quero** seguir um pedido pelo `correlationId` da API até o worker
> **para** responder "por que o pedido X está PENDING há 10 minutos" em minutos, não em horas.

**Critérios de aceite**

- [ ] Todo log é JSON com `level`, `time`, `msg` e `correlationId`.
- [ ] O `correlationId` nasce no `POST` (ou vem do header do cliente), é gravado em `orders.correlation_id`, viaja no payload do evento e no header AMQP, e reaparece nos logs do relay e do consumidor.
- [ ] `docker compose logs | grep '"correlationId":"<id>"'` reconstrói a linha do tempo nos três processos.
- [ ] Um pedido preso permite descobrir **em qual dos três** ele parou: outbox `PENDING` com `attempts > 0` e `last_error` preenchido aponta o relay; mensagem na fila sem consumidor aponta o worker.
- [ ] Senha, token e `authorization` aparecem redigidos.

---

## US-10 — Delegar a identidade a um provedor de SSO (bônus)

> **Como** responsável pela API
> **quero** delegar a identidade a um provedor externo sem mudar o contrato da API
> **para** que trocar de provedor seja decisão de infraestrutura, não de produto.

**Critérios de aceite**

- [ ] `AUTH_PROVIDER=keycloak` troca emissão e validação sem mudar nenhuma rota.
- [ ] Token RS256 emitido pelo provedor abre as rotas protegidas.
- [ ] O papel vem do claim `realm_access.roles` do provedor, não de tabela local.
- [ ] Papel que a aplicação não conhece (`offline_access`) **não** vira privilégio.
- [ ] Token de outro emissor é recusado, mesmo com assinatura válida.
- [ ] Token assinado por chave fora do JWKS é recusado.
- [ ] **Com o provedor fora do ar, quem já tem token válido continua trabalhando** —
      validar não pode fazer chamada de rede ao provedor.
- [ ] Com o provedor fora, o login novo falha como erro de infraestrutura, e não
      como "credencial inválida".
- [ ] `src/domain/` e `src/application/` não mudam uma linha por causa da troca.

**O que essa história comprou.** A frase "trocar de provedor substitui duas
classes" deixou de ser promessa. Foram exatamente duas —
`KeycloakJwksVerifier` e `KeycloakCredentialsAuthenticator` — mais três linhas de
seleção no `SecurityModule`.

**Ressalva registrada.** O *Resource Owner Password Credentials* existe para
manter o Swagger testável com um clique. Em produção com front-end, entra o
*Authorization Code Flow with PKCE*, e a senha nunca chega nesta API. Troca uma
classe.

---

## US-11 — Sinalizar saúde para a operação

> **Como** responsável pela operação
> **quero** que liveness e readiness respondam perguntas diferentes
> **para** que uma oscilação de dependência não reinicie a frota inteira.

**Critérios de aceite**

- [ ] `GET /health/live` responde 200 **sem consultar nenhuma dependência**.
- [ ] `GET /health/ready` checa MySQL e RabbitMQ e nomeia cada um no corpo.
- [ ] Uma dependência fora devolve **503** no readiness e mantém o liveness em 200.
- [ ] Sonda que lança devolve "indisponível", nunca 500.
- [ ] Ambos são públicos: `docker compose up --wait` depende disso.

**Por que isso é uma história, e não um detalhe.** Se o liveness checasse o banco,
uma instabilidade de MySQL reiniciaria todos os containers ao mesmo tempo — o
health check seria a causa do apagão, não o detector.

---

## US-12 — Aguentar carga sem travar a API

> **Como** responsável pela operação
> **quero** que a criação do pedido continue rápida com o worker saturado
> **para** que um pico de processamento não vire indisponibilidade da API.

**Critérios de aceite**

- [ ] `POST /orders` mantém p95 abaixo de 300 ms sob 30 usuários simultâneos.
- [ ] Com o worker saturado, a conclusão do pedido demora mais **e o `POST` não**.
- [ ] Escalar o consumidor aumenta a vazão sem mudança de código.
- [ ] Nenhum pedido se perde em nenhum dos cenários.
- [ ] Sob 40 pedidos HTTP simultâneos com estoque 5: exatamente 5 confirmados.

**Dono dos cenários.** `desempenho.feature` é executada pelo **k6**, em
`load/k6/`, por fora e via HTTP contra containers separados. Sem step
definitions, e de propósito: medir latência de dentro do processo medido não
mede nada, e rampa, taxa de chegada e limiares não cabem no harness de BDD.
Números em [`../load/README.md`](../load/README.md).

---

## US-13 — Integrar sem ler o código (bônus)

> **Como** pessoa que vai integrar com esta API
> **quero** abrir uma página e testar todos os endpoints
> **para** não precisar ler o código-fonte para descobrir o contrato.

**Critérios de aceite**

- [ ] `/docs` é público e responde 200.
- [ ] **Toda rota implementada aparece documentada** — e nenhuma rota documentada
      deixou de existir na aplicação.
- [ ] Cada resposta tem **schema**, não só um código de status.
- [ ] O corpo de erro documentado inclui `code`, `message` e `correlationId`.
- [ ] Há exemplos prontos de payload, inclusive do **cenário de falha**.
- [ ] O esquema de autenticação está declarado, e as rotas públicas não o exigem.

**Por que isso é história, e não "gerar Swagger".** Documentação escrita à mão
envelhece em silêncio: a rota muda, o texto não, e quem integra descobre pelo
404. O cenário `@contrato` verifica os dois sentidos — rota sem documentação e
documentação sem rota —, então a página não tem como divergir do código sem
quebrar o CI.

---

## 3. Definição de pronto (vale para toda história)

Uma história só está pronta quando **todas** as linhas abaixo são verdade:

1. O `.feature` dela existe e todos os cenários passam.
2. Os testes unitários da lógica que ela introduziu existem e passam.
3. A suíte de arquitetura continua verde — nenhuma fronteira foi furada no caminho.
4. O comportamento foi verificado **contra MySQL e RabbitMQ reais**, não contra mock.
5. Existe pelo menos um teste que **falharia** se o bug óbvio daquela história existisse.
6. O commit é um Conventional Commit que descreve o que mudou, não "ajustes".
