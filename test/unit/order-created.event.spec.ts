import { OrderCreatedEvent } from '../../src/domain/order/events/order-created.event';
import { BusinessRuleViolation } from '../../src/domain/shared/errors';

const OCORRIDO_EM = new Date('2026-01-01T10:00:00.000Z');
const evento = new OrderCreatedEvent('evt-1', 'order-1', 'corr-1', OCORRIDO_EM);

describe('OrderCreatedEvent', () => {
  it('serializa com nome e versao explicitos', () => {
    expect(evento.toPayload()).toEqual({
      eventId: 'evt-1',
      eventName: 'order.created',
      version: 1,
      orderId: 'order-1',
      correlationId: 'corr-1',
      occurredAt: '2026-01-01T10:00:00.000Z',
    });
  });

  it('faz ida e volta sem perder informacao', () => {
    const voltou = OrderCreatedEvent.fromPayload(evento.toPayload());
    expect(voltou.eventId).toBe('evt-1');
    expect(voltou.orderId).toBe('order-1');
    expect(voltou.correlationId).toBe('corr-1');
    expect(voltou.occurredAt).toEqual(OCORRIDO_EM);
  });

  it.each([
    ['nao e objeto', 'texto solto'],
    ['e nulo', null],
    ['sem eventId', { ...evento.toPayload(), eventId: '' }],
    ['sem orderId', { ...evento.toPayload(), orderId: undefined }],
    ['sem correlationId', { ...evento.toPayload(), correlationId: 42 }],
    ['com data invalida', { ...evento.toPayload(), occurredAt: 'ontem' }],
    ['de outro evento', { ...evento.toPayload(), eventName: 'order.cancelled' }],
    ['de versao futura', { ...evento.toPayload(), version: 2 }],
  ])('recusa payload que %s, como erro de negocio', (_caso, payload) => {
    expect(() => OrderCreatedEvent.fromPayload(payload)).toThrow(BusinessRuleViolation);
    try {
      OrderCreatedEvent.fromPayload(payload);
    } catch (erro) {
      expect((erro as BusinessRuleViolation).code).toBe('MALFORMED_EVENT');
    }
  });

  it.each([
    ['texto', '{"eventId":"x"}'],
    ['número', 7],
    ['nulo', null],
    ['booleano', true],
  ])('recusa payload que nem objeto é — %s', (_caso, bruto) => {
    // Sem esta guarda, um payload que não é objeto seguiria adiante e seria
    // recusado mais tarde por "campos faltando" — mesmo código, diagnóstico
    // errado. A mensagem é o que separa um caso do outro.
    expect(() => OrderCreatedEvent.fromPayload(bruto)).toThrow(
      'Payload do evento nao e um objeto',
    );
  });

});
