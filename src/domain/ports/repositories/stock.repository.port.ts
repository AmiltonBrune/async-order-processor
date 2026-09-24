export interface StockRepository {
  reserve(orderId: string, productId: number, quantity: number, at: Date): Promise<boolean>;
}
