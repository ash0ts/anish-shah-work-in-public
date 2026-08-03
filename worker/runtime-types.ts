export interface WorkerEnv {
  ASSETS: Fetcher;
  DB?: D1Database;
  PUBLICATION_CACHE?: KVNamespace;
  OWNER_RATE_LIMITER?: RateLimitBinding;
  ARTWORK_RATE_LIMITER?: RateLimitBinding;
  PROMOTION_RATE_LIMITER?: RateLimitBinding;
  OAUTH_CALLBACK_RATE_LIMITER?: RateLimitBinding;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  AUTH_MODE?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  NODE_ENV?: string;
  RATE_LIMIT_SALT?: string;
  RELEASE_SHA?: string;
  CONTENT_VERSION?: string;
  PUBLIC_CONTENT_MODE?: string;
  SITE_URL?: string;
  PRODUCTION_SITE_URL?: string;
  DEPLOYMENT_TIER?: string;
  PREVIEW_PR_NUMBER?: string;
  PLAY_EXPERIENCE_MODE?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface WorkerScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

export type AccessIdentity = { email: string };
