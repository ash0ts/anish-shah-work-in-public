import type { ConnectorProvider } from "./types";

export type ConnectorHealth = {
  provider: ConnectorProvider;
  configured: boolean;
  canReuseOAuthClient: boolean;
  status:
    | "setup_required"
    | "authorization_required"
    | "reauthorization_required"
    | "never_synced"
    | "healthy"
    | "stale"
    | "syncing"
    | "visibility_required"
    | "error";
  lastSyncedAt: string | null;
  freshUntil: string | null;
  credentialExpiresAt: string | null;
  authorizedAt: string | null;
  lastRunStatus: string | null;
  lastErrorCode: string | null;
  retryNotBefore: string | null;
  itemCount: number | null;
};

export type StudioOverview =
  | {
      status: "ready";
      encryptionConfigured: boolean;
      steamStorageCountries: string | null;
      publicationCounts: Record<string, number>;
      connectors: ConnectorHealth[];
      latestPublication: {
        id: string;
        contentHash: string;
        recordCount: number;
        publishedAt: string;
      } | null;
    }
  | {
      status: "database_setup_required";
      reason: "binding_unavailable" | "schema_unavailable" | "database_error";
      encryptionConfigured: boolean;
      steamStorageCountries: string | null;
      connectors: ConnectorHealth[];
    };

export type PublicSnapshotResult =
  | {
      status: "ready";
      provider: ConnectorProvider;
      payload: Record<string, unknown>;
      fetchedAt: string;
      freshUntil: string;
      stale: boolean;
    }
  | {
      status: "unavailable";
      provider: ConnectorProvider;
      reason:
        | "not_configured"
        | "never_synced"
        | "invalid_snapshot"
        | "visibility_withheld"
        | "stale_expired"
        | "database_unavailable";
    };

export type RefreshResult =
  | {
      status: "complete";
      provider: ConnectorProvider;
      itemCount: number;
      fetchedAt: string;
    }
  | {
      status: "already_running";
      provider: ConnectorProvider;
    }
  | {
      status: "not_due";
      provider: ConnectorProvider;
    }
  | {
      status: "withheld";
      provider: "steam";
      reason: "visibility_unavailable";
      fetchedAt: string;
    }
  | {
      status: "setup_required";
      provider: ConnectorProvider;
      reason:
        | "database"
        | "credential"
        | "encryption_key"
        | "storage_disclosure";
    }
  | {
      status: "failed";
      provider: ConnectorProvider;
      code: string;
      retryable: boolean;
      retryNotBefore?: string;
    };

export type MyAnimeListOAuthStartResult =
  | {
      status: "authorization_required";
      provider: "myanimelist";
      authorizationUrl: string;
      callbackUrl: string;
      expiresAt: string;
    }
  | {
      status: "invalid";
      reason: "credential";
    }
  | {
      status: "setup_required";
      reason: "database" | "encryption_key" | "callback_url";
    };

export type MyAnimeListOAuthStageResult =
  | { status: "ready"; resumeState: string }
  | {
      status:
        | "expired"
        | "invalid_state"
        | "setup_required";
    };

export type MyAnimeListOAuthCompletionResult =
  | { status: "connected" }
  | {
      status:
        | "denied"
        | "expired"
        | "invalid_state"
        | "provider_unavailable"
        | "rate_limited"
        | "token_exchange_failed"
        | "setup_required";
    };
