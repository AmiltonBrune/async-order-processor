import { createPublicKey } from 'node:crypto';

interface Jwk {
  readonly kid?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
}

export class JwksCache {
  private chaves = new Map<string, string>();
  private buscadoEm = 0;
  private ultimaRenovacaoPorKid = Number.NEGATIVE_INFINITY;
  private emVoo: Promise<void> | null = null;

  constructor(
    private readonly jwksUri: string,
    private readonly ttlMs = 600_000,
    private readonly intervaloMinimoMs = 30_000,
    private readonly timeoutMs = 5_000,
  ) {}

  async chavePublica(kid: string, agora = Date.now()): Promise<string> {
    const emCache = this.chaves.get(kid);
    const vencido = agora - this.buscadoEm >= this.ttlMs;
    if (emCache !== undefined && !vencido) return emCache;

    const semNada = this.chaves.size === 0;
    if (semNada || vencido) {
      await this.renovar(agora, semNada);
    } else if (agora - this.ultimaRenovacaoPorKid >= this.intervaloMinimoMs) {
      this.ultimaRenovacaoPorKid = agora;
      await this.renovar(agora, false);
    }

    const chave = this.chaves.get(kid);
    if (chave === undefined) {
      throw new Error(`Chave de assinatura desconhecida: kid=${kid}`);
    }
    return chave;
  }

  private async renovar(agora: number, obrigatoria: boolean): Promise<void> {
    if (this.emVoo !== null) return this.emVoo;
    this.emVoo = this.buscar(agora, obrigatoria).finally(() => {
      this.emVoo = null;
    });
    return this.emVoo;
  }

  private async buscar(agora: number, obrigatoria: boolean): Promise<void> {
    try {
      const resposta = await fetch(this.jwksUri, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!resposta.ok) throw new Error(`JWKS respondeu ${resposta.status}`);

      const corpo = (await resposta.json()) as { keys?: unknown };
      const jwks = Array.isArray(corpo.keys) ? (corpo.keys as Jwk[]) : [];
      const novas = new Map<string, string>();
      for (const jwk of jwks) {
        if (typeof jwk.kid !== 'string') continue;
        if (jwk.use !== undefined && jwk.use !== 'sig') continue;
        if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
        novas.set(
          jwk.kid,
          createPublicKey({ key: jwk as never, format: 'jwk' }).export({
            type: 'spki',
            format: 'pem',
          }) as string,
        );
      }
      if (novas.size === 0) throw new Error('JWKS sem nenhuma chave de assinatura RS256');

      this.chaves = novas;
      this.buscadoEm = agora;
    } catch (erro) {
      // Sem chave nenhuma em cache não há o que servir: o erro sobe.
      // Com chave em cache, servir a velha é melhor que recusar todo mundo por
      // um soluço de rede — chave RSA não expira junto com a conexão.
      if (obrigatoria || this.chaves.size === 0) throw erro;
    }
  }
}
