export interface D1Result<T> {
  results: T[];
  success: boolean;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

/** Workers rate limiting binding (`ratelimits` in wrangler.jsonc). */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Bindings {
  DB: D1Database;
  INGEST_API_KEY: string;
  EIA_API_KEY?: string;
  /** Comma-separated keys of approved clients, sent as `x-api-key`. */
  API_CLIENT_KEYS?: string;
  ANON_RATE_LIMIT?: RateLimit;
  CLIENT_RATE_LIMIT?: RateLimit;
  /** Set only by the service-binding entrypoint used by the web app. */
  TRUSTED?: boolean;
}

export function nowIso(): string {
  return new Date().toISOString();
}
