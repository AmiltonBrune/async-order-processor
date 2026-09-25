#!/usr/bin/env bash
#
# Sobe o projeto do zero e prova que funcionou.
#
#   ./setup.sh              # autenticação local (padrão, rápido)
#   ./setup.sh keycloak     # autenticação via Keycloak
#   ./setup.sh --reset      # apaga os volumes antes de subir
#
# Único pré-requisito: Docker com Compose v2.

set -euo pipefail

MODO="local"
RESET=0
for arg in "$@"; do
  case "$arg" in
    keycloak) MODO="keycloak" ;;
    local)    MODO="local" ;;
    --reset)  RESET=1 ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "argumento desconhecido: $arg (use: local | keycloak | --reset)" >&2; exit 2 ;;
  esac
done

VERDE=$'\e[32m'; VERMELHO=$'\e[31m'; AMARELO=$'\e[33m'; NEGRITO=$'\e[1m'; FIM=$'\e[0m'
ok()    { printf '  %s✓%s %s\n' "$VERDE" "$FIM" "$1"; }
erro()  { printf '  %s✗%s %s\n' "$VERMELHO" "$FIM" "$1"; }
aviso() { printf '  %s!%s %s\n' "$AMARELO" "$FIM" "$1"; }
etapa() { printf '\n%s%s%s\n' "$NEGRITO" "$1" "$FIM"; }

cd "$(dirname "$0")"

# ---------------------------------------------------------------- pré-requisitos
etapa "1/5  Pré-requisitos"

if ! command -v docker >/dev/null 2>&1; then
  erro "Docker não encontrado. Instale em https://docs.docker.com/get-docker/"
  exit 1
fi
ok "docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

if ! docker compose version >/dev/null 2>&1; then
  erro "Docker Compose v2 não encontrado (o comando é 'docker compose', sem hífen)."
  exit 1
fi
ok "compose $(docker compose version --short 2>/dev/null || echo v2)"

if ! docker info >/dev/null 2>&1; then
  erro "O daemon do Docker não está rodando. Inicie o Docker e rode de novo."
  exit 1
fi
ok "daemon respondendo"

# Porta ocupada é o motivo nº 1 de 'subiu mas não responde'. Melhor dizer agora.
porta_ocupada() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }
PORTAS=("3000:API" "3001:métricas do relay" "3306:MySQL" "5672:RabbitMQ" "15672:UI do RabbitMQ")
[ "$MODO" = "keycloak" ] && PORTAS+=("8081:Keycloak")
CONFLITO=0
for entrada in "${PORTAS[@]}"; do
  porta="${entrada%%:*}"; nome="${entrada#*:}"
  if porta_ocupada "$porta"; then
    aviso "porta $porta ($nome) já está em uso"
    CONFLITO=1
  fi
done
if [ "$CONFLITO" = "1" ]; then
  aviso "Se a stack já estiver de pé, isto é esperado — o script vai recriá-la."
  aviso "Senão, libere as portas ou exporte HTTP_PORT, MYSQL_PORT, RABBITMQ_PORT..."
else
  ok "portas livres"
fi

# ---------------------------------------------------------------------- subida
COMPOSE=(docker compose -f docker-compose.yml)
[ "$MODO" = "keycloak" ] && COMPOSE+=(-f docker-compose.keycloak.yml)

etapa "2/5  Subindo a stack (modo: $MODO)"
if [ "$RESET" = "1" ]; then
  aviso "--reset: apagando volumes"
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
fi
echo "  primeira vez leva alguns minutos (build da imagem + download)..."
if ! "${COMPOSE[@]}" up -d --build --wait; then
  erro "A stack não ficou saudável. Veja o que aconteceu com:"
  echo "      ${COMPOSE[*]} logs --tail=50"
  exit 1
fi
ok "todos os contêineres saudáveis"

# ------------------------------------------------------------------- migrations
etapa "3/5  Banco"
TABELAS=$("${COMPOSE[@]}" exec -T mysql mysql -uorders -porders orders -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='orders'" 2>/dev/null | tail -1)
ok "$TABELAS tabelas criadas pelas migrations"
PRODUTOS=$("${COMPOSE[@]}" exec -T mysql mysql -uorders -porders orders -N -e \
  "SELECT COUNT(*) FROM products" 2>/dev/null | tail -1)
ok "$PRODUTOS produtos no catálogo, 5 unidades cada"

# ------------------------------------------------------------ prova de que roda
etapa "4/5  Provando que funciona de ponta a ponta"
API="http://localhost:${HTTP_PORT:-3000}"

TOKEN=$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d '{"email":"cliente@loja.test","password":"cliente123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])' 2>/dev/null) || {
  erro "login falhou"; exit 1; }
ok "login ($([ "$MODO" = keycloak ] && echo 'via Keycloak, RS256' || echo 'local, HS256'))"

PEDIDO=$(curl -fsS -X POST "$API/orders" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"customerName":"Setup","items":[{"productName":"Teclado Mecanico","quantity":1,"price":"249.90"}]}')
ID=$(echo "$PEDIDO" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
ok "pedido criado, respondeu PENDING na hora"

STATUS="PENDING"
for _ in $(seq 1 30); do
  sleep 1
  STATUS=$(curl -fsS "$API/orders/$ID" -H "authorization: Bearer $TOKEN" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  [ "$STATUS" != "PENDING" ] && break
done
if [ "$STATUS" = "PROCESSED" ]; then
  ok "worker concluiu o pedido: outbox → relay → RabbitMQ → consumer → estoque"
else
  erro "pedido ficou em $STATUS. Investigue com: ${COMPOSE[*]} logs relay consumer"
  exit 1
fi

# ------------------------------------------------------------------ o que fazer
etapa "5/5  Pronto"
cat <<FIM_TEXTO

  ${NEGRITO}Abra o Swagger:${FIM}  $API/docs
  Dá para testar todos os endpoints por lá. Faça POST /auth/login, copie o
  accessToken, clique em Authorize (cadeado) e cole.

  ${NEGRITO}Credenciais${FIM}
    cliente@loja.test / cliente123   (papel CUSTOMER)
    admin@loja.test   / admin123     (papel ADMIN, libera o /reprocess)

  ${NEGRITO}Endereços${FIM}
    $API/docs             Swagger
    $API/health/ready     readiness
    $API/metrics          métricas da API
    http://localhost:3001/metrics          métricas do relay
    http://localhost:15672                 RabbitMQ (orders / orders)
FIM_TEXTO
[ "$MODO" = "keycloak" ] && echo "    http://localhost:8081                  Keycloak (admin / admin)"
cat <<FIM_TEXTO

  ${NEGRITO}Comandos úteis${FIM}
    npm run db:reset-stock     repõe o estoque sem apagar os pedidos
    npm run test:fast          testes que não precisam de Docker
    npm run test:all           suíte completa
    npm run load:smoke         teste de carga (precisa do k6)
    docker compose down        para tudo
    docker compose down -v     para e apaga os dados

FIM_TEXTO
