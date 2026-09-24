export const EVENTS_EXCHANGE = 'orders.events';
export const RETRY_EXCHANGE = 'orders.retry';
export const DEAD_EXCHANGE = 'orders.dead';

export const MAIN_QUEUE = 'orders.created';
export const DEAD_QUEUE = 'orders.dead';

export const ORDER_CREATED_ROUTING_KEY = 'order.created';

export const ATTEMPT_HEADER = 'x-attempt';
export const DEATH_REASON_HEADER = 'x-death-reason';

export const MESSAGE_TTL_ARG = 'x-message-ttl';
export const DEAD_LETTER_EXCHANGE_ARG = 'x-dead-letter-exchange';
export const DEAD_LETTER_ROUTING_KEY_ARG = 'x-dead-letter-routing-key';

export const RESERVA_DA_OUTBOX_SEGUNDOS = 30;
