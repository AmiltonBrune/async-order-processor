import { BusinessRuleViolation } from '../../../domain/shared/errors';
import { CORRELATION_HEADER } from '../../observability/correlation.constants';
import { ATTEMPT_HEADER, DEATH_REASON_HEADER } from '../messaging.constants';


export interface DecodedMessage {
  readonly payload: Record<string, unknown>;
  readonly attempt: number;
  readonly correlationId: string;
}

export class MessageCodec {
  static encode(payload: Record<string, unknown>): Buffer {
    return Buffer.from(JSON.stringify(payload), 'utf8');
  }

  static decode(content: Buffer, headers: Record<string, unknown> = {}): DecodedMessage {
    let payload: unknown;
    try {
      payload = JSON.parse(content.toString('utf8'));
    } catch {
      throw new BusinessRuleViolation('MALFORMED_EVENT', 'Corpo da mensagem nao e JSON valido');
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new BusinessRuleViolation('MALFORMED_EVENT', 'Corpo da mensagem nao e um objeto');
    }
    const record = payload as Record<string, unknown>;
    return {
      payload: record,
      attempt: MessageCodec.attemptOf(headers),
      correlationId: MessageCodec.correlationIdOf(headers, record),
    };
  }

  static attemptOf(headers: Record<string, unknown>): number {
    const raw = headers[ATTEMPT_HEADER];
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  }

  static correlationIdOf(
    headers: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): string {
    const fromHeader = headers[CORRELATION_HEADER];
    if (typeof fromHeader === 'string' && fromHeader !== '') return fromHeader;
    if (Buffer.isBuffer(fromHeader)) return fromHeader.toString('utf8');
    const fromPayload = payload['correlationId'];
    return typeof fromPayload === 'string' ? fromPayload : '';
  }

  static headersFor(attempt: number, correlationId: string, deathReason?: string): Record<string, unknown> {
    return {
      [ATTEMPT_HEADER]: attempt,
      [CORRELATION_HEADER]: correlationId,
      ...(deathReason === undefined ? {} : { [DEATH_REASON_HEADER]: deathReason.slice(0, 255) }),
    };
  }
}
