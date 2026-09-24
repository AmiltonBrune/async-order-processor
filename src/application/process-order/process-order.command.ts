export interface ProcessOrderCommand {
  readonly eventId: string;
  readonly orderId: string;
  readonly correlationId: string;
  readonly consumer: string;
  readonly attempt: number;
}

export type ProcessOrderOutcome =
  | 'PROCESSED'
  | 'FAILED'
  | 'DUPLICATE'
  | 'DEAD_LETTER';
