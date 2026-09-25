export interface CreateOrderItemInput {
  readonly productName: string;
  readonly price: string;
  readonly quantity: number;
}

export interface CreateOrderCommand {
  readonly customerName: string;
  /** Subject do token de quem chamou. Define quem pode ver o pedido depois. */
  readonly createdBy: string;
  readonly items: readonly CreateOrderItemInput[];
  readonly correlationId: string;
}
