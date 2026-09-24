import { MessageCodec } from '../../src/infrastructure/messaging/codec/message.codec';
import { BusinessRuleViolation } from '../../src/domain/shared/errors';

describe('MessageCodec', () => {
  it('faz ida e volta do payload', () => {
    const payload = { eventId: 'evt-1', orderId: 'order-1' };
    const decodificado = MessageCodec.decode(MessageCodec.encode(payload));
    expect(decodificado.payload).toEqual(payload);
  });

  it('JSON invalido e erro de NEGOCIO, nao transitorio', () => {
    expect(() => MessageCodec.decode(Buffer.from('{ nao e json'))).toThrow(BusinessRuleViolation);
    expect(() => MessageCodec.decode(Buffer.from('"so uma string"'))).toThrow(BusinessRuleViolation);
  });

  describe('x-attempt', () => {
    it('sem header, e a primeira tentativa', () => {
      expect(MessageCodec.decode(MessageCodec.encode({})).attempt).toBe(1);
    });

    it.each([
      ['number', 3, 3],
      ['string', '2', 2],
      ['lixo', 'abc', 1],
      ['zero', 0, 1],
      ['negativo', -5, 1],
    ])('tolera %s no header e nunca devolve menos de 1', (_caso, header, esperado) => {
      expect(MessageCodec.attemptOf({ 'x-attempt': header })).toBe(esperado);
    });
  });

  describe('correlationId', () => {
    it('prefere o header', () => {
      const decodificado = MessageCodec.decode(MessageCodec.encode({ correlationId: 'do-payload' }), {
        'x-correlation-id': 'do-header',
      });
      expect(decodificado.correlationId).toBe('do-header');
    });

    it('aceita header como Buffer, que e como o amqplib as vezes entrega', () => {
      expect(
        MessageCodec.correlationIdOf({ 'x-correlation-id': Buffer.from('corr-b') }, {}),
      ).toBe('corr-b');
    });

    it('cai para o payload quando o header nao veio', () => {
      expect(MessageCodec.correlationIdOf({}, { correlationId: 'corr-p' })).toBe('corr-p');
      expect(MessageCodec.correlationIdOf({}, {})).toBe('');
    });
  });

  it('monta os headers da republicacao com tentativa, correlacao e motivo', () => {
    expect(MessageCodec.headersFor(2, 'corr-1', 'deadlock')).toEqual({
      'x-attempt': 2,
      'x-correlation-id': 'corr-1',
      'x-death-reason': 'deadlock',
    });
    expect(MessageCodec.headersFor(1, 'corr-1')).not.toHaveProperty('x-death-reason');
  });

  it('trunca o motivo para caber na coluna de 255', () => {
    const headers = MessageCodec.headersFor(1, 'c', 'x'.repeat(300));
    expect(String(headers['x-death-reason'])).toHaveLength(255);
  });
});
