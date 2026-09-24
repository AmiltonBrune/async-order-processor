export interface Transformer<Dominio, Gravado, Lido = Gravado> {
  to(value: Dominio | null | undefined): Gravado | null;
  from(value: Lido | null | undefined): Dominio | null;
}
