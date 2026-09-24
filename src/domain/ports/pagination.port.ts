export interface Page<T> {
  readonly data: readonly T[];
  readonly total: number;
}
