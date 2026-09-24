export interface InboxRepository {
  register(consumer: string, eventId: string, orderId: string, at: Date): Promise<boolean>;
}
