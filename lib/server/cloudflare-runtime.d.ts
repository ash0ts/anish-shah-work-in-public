type D1Primitive = null | number | string | ArrayBuffer;

interface D1Meta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
  error?: string;
}

interface D1PreparedStatement {
  bind(...values: D1Primitive[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: Record<string, unknown> },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<{ key: string; size: number; httpEtag: string }>;
  delete(key: string | string[]): Promise<void>;
}

interface ImagesBinding {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: {
        format: string;
        quality: number;
      }): Promise<{ response(): Response }>;
    };
  };
}

interface CloudflareRuntimeEnv {
  DB?: D1Database;
  PUBLICATION_CACHE?: KVNamespace;
  TRAVEL_MEDIA?: R2Bucket;
  IMAGES?: ImagesBinding;
  [key: string]: unknown;
}

declare module "cloudflare:workers" {
  export const env: CloudflareRuntimeEnv;
}
