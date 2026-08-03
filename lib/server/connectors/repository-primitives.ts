import { runtimeDatabase } from "../runtime-env";
import type { ConnectorHealth } from "./repository-contracts";
import type { ConnectorProvider } from "./types";

export function databaseOrNull(): D1Database | null {
  return runtimeDatabase();
}

export function placeholderHealth(
  provider: ConnectorProvider,
): ConnectorHealth {
  return {
    provider,
    configured: false,
    canReuseOAuthClient: false,
    status: "setup_required",
    lastSyncedAt: null,
    freshUntil: null,
    credentialExpiresAt: null,
    authorizedAt: null,
    lastRunStatus: null,
    lastErrorCode: null,
    retryNotBefore: null,
    itemCount: null,
  };
}

export function asCount(value: unknown): number {
  return typeof value === "number" ? value : Number(value) || 0;
}

export function normalizedOwnerEmail(value: string): string {
  return value.trim().toLowerCase();
}
