#!/usr/bin/env bash
# Devolve o ambiente a um estado conhecido antes de uma rodada de carga.
#
# Limpar só o banco NÃO basta, e isso custou uma rodada inteira de medição: as
# mensagens já publicadas continuam no RabbitMQ. Com as linhas apagadas, o
# consumidor as processa, não acha o pedido e manda para a dead-letter — o que
# está certo, mas consome a vazão do worker e coloca os pedidos novos atrás de
# milhares de mensagens órfãs. O resultado foi um teste de carga medindo fila
# represada em vez de latência.
set -uo pipefail

ESTOQUE="${1:-5}"
FILAS=(orders.created orders.dead orders.retry.5s orders.retry.15s orders.retry.45s)

echo "→ limpando pedidos e repondo estoque para ${ESTOQUE}"
docker compose exec -T mysql mysql -uorders -porders orders -e "
  DELETE FROM stock_reservations;
  DELETE FROM order_items;
  DELETE FROM orders;
  DELETE FROM outbox_messages;
  DELETE FROM inbox_messages;
  UPDATE products SET stock = ${ESTOQUE};
" 2>/dev/null

echo "→ purgando as filas do broker"
for fila in "${FILAS[@]}"; do
  docker compose exec -T rabbitmq rabbitmqctl purge_queue "${fila}" >/dev/null 2>&1 || true
done

echo "→ estado pronto:"
docker compose exec -T mysql mysql -uorders -porders orders -N -B -e \
  "SELECT name, stock FROM products" 2>/dev/null | awk -F'\t' '{printf "   %-24s %s\n", $1, $2}' 
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages 2>/dev/null \
  | awk 'NF == 2 && $1 != "name" {printf "   %-24s %s\n", $1, $2}'
