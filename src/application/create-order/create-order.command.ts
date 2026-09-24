export interface CreateOrderItemInput {
  readonly productName: string;
  readonly price: string;
  readonly quantity: number;
}

export interface CreateOrderCommand {
  readonly customerName: string;
  readonly items: readonly CreateOrderItemInput[];
  readonly correlationId: string;
}
