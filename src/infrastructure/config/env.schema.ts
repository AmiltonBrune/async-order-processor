
export type AppRole = 'api' | 'relay' | 'consumer';
export type AuthProvider = 'local' | 'keycloak';

export interface Env {
  readonly nodeEnv: string;
  readonly appRole: AppRole;
  readonly httpPort: number;
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly name: string;
    readonly poolSize: number;
  };
  readonly amqpUrl: string;
  readonly consumerName: string;
  readonly prefetch: number;
  readonly retryTiersMs: readonly number[];
  readonly processingDelayMs: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxBatchSize: number;
  readonly maxPublishAttempts: number;
  /** Dias de histórico mantidos em outbox_messages e inbox_messages. */
  readonly retentionDays: number;
  readonly jwtSecret: string;
  readonly jwtExpiresInSeconds: number;
  readonly authProvider: AuthProvider;
  readonly keycloak: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
  };
  readonly logLevel: string;
}

const APP_ROLES: readonly AppRole[] = ['api', 'relay', 'consumer'];
const AUTH_PROVIDERS: readonly AuthProvider[] = ['local', 'keycloak'];

class EnvReader {
  private readonly problems: string[] = [];

  constructor(private readonly source: Record<string, string | undefined>) {}

  required(key: string): string {
    const value = this.source[key];
    if (value === undefined || value.trim() === '') {
      this.problems.push(`${key} e obrigatoria`);
      return '';
    }
    return value;
  }

  optional(key: string, fallback: string): string {
    const value = this.source[key];
    return value === undefined || value.trim() === '' ? fallback : value;
  }

  integer(key: string, fallback: number, min = 1): number {
    const raw = this.source[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < min) {
      this.problems.push(`${key} deve ser um inteiro >= ${min}, recebido "${raw}"`);
      return fallback;
    }
    return parsed;
  }

  integerList(key: string, fallback: readonly number[]): readonly number[] {
    const raw = this.source[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const parts = raw.split(',').map((part) => Number.parseInt(part.trim(), 10));
    if (parts.length === 0 || parts.some((part) => Number.isNaN(part) || part < 1)) {
      this.problems.push(`${key} deve ser uma lista de inteiros positivos, recebido "${raw}"`);
      return fallback;
    }
    return parts;
  }

  role(key: string): AppRole {
    const value = this.optional(key, 'api');
    const role = APP_ROLES.find((candidate) => candidate === value);
    if (role === undefined) {
      this.problems.push(`${key} deve ser um de ${APP_ROLES.join(' | ')}, recebido "${value}"`);
      return 'api';
    }
    return role;
  }

  authProvider(key: string): AuthProvider {
    const value = this.optional(key, 'local');
    const provider = AUTH_PROVIDERS.find((candidate) => candidate === value);
    if (provider === undefined) {
      this.problems.push(
        `${key} deve ser um de ${AUTH_PROVIDERS.join(' | ')}, recebido "${value}"`,
      );
      return 'local';
    }
    return provider;
  }

  assertValid(): void {
    if (this.problems.length > 0) {
      throw new Error(
        `Ambiente invalido — o processo nao sobe:\n  - ${this.problems.join('\n  - ')}`,
      );
    }
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const reader = new EnvReader(source);
  const authProvider = reader.authProvider('AUTH_PROVIDER');
  const keycloakAtivo = authProvider === 'keycloak';
  const env: Env = {
    nodeEnv: reader.optional('NODE_ENV', 'development'),
    appRole: reader.role('APP_ROLE'),
    httpPort: reader.integer('HTTP_PORT', 3000),
    db: {
      host: reader.required('DB_HOST'),
      port: reader.integer('DB_PORT', 3306),
      user: reader.required('DB_USER'),
      password: reader.required('DB_PASSWORD'),
      name: reader.required('DB_NAME'),
      // Precisa ser maior que o paralelismo dos testes de concorrencia; um pool
      // pequeno serializa as tarefas e o teste passa sem ter havido concorrencia.
      poolSize: reader.integer('DB_POOL_SIZE', 20),
    },
    amqpUrl: reader.required('AMQP_URL'),
    consumerName: reader.optional('CONSUMER_NAME', 'order-processor'),
    prefetch: reader.integer('AMQP_PREFETCH', 10),
    retryTiersMs: reader.integerList('RETRY_TIERS_MS', [5_000, 15_000, 45_000]),
    processingDelayMs: reader.integer('PROCESSING_DELAY_MS', 1_500, 0),
    outboxPollIntervalMs: reader.integer('OUTBOX_POLL_INTERVAL_MS', 500),
    outboxBatchSize: reader.integer('OUTBOX_BATCH_SIZE', 50),
    maxPublishAttempts: reader.integer('MAX_PUBLISH_ATTEMPTS', 10),
    retentionDays: reader.integer('RETENTION_DAYS', 30),
    jwtSecret: reader.required('JWT_SECRET'),
    jwtExpiresInSeconds: reader.integer('JWT_EXPIRES_IN_SECONDS', 3_600),
    authProvider,
    keycloak: {
      // Obrigatorias so quando o provedor e o Keycloak: exigir sempre faria o
      // caminho padrao precisar de configuracao que ele nao usa.
      issuer: keycloakAtivo ? reader.required('KEYCLOAK_ISSUER') : reader.optional('KEYCLOAK_ISSUER', ''),
      clientId: keycloakAtivo
        ? reader.required('KEYCLOAK_CLIENT_ID')
        : reader.optional('KEYCLOAK_CLIENT_ID', ''),
      clientSecret: keycloakAtivo
        ? reader.required('KEYCLOAK_CLIENT_SECRET')
        : reader.optional('KEYCLOAK_CLIENT_SECRET', ''),
    },
    logLevel: reader.optional('LOG_LEVEL', 'info'),
  };
  reader.assertValid();
  return env;
}

