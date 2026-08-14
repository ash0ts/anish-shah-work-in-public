import { classifyDatabaseError } from "../database-errors";
import { runtimeValue } from "../runtime-env";
import {
  asCount,
  databaseOrNull,
  normalizedOwnerEmail,
  placeholderHealth,
} from "./repository-primitives";
import { discogsRetryNotBefore } from "./discogs-retry";
import type {
  ConnectorHealth,
  StudioOverview,
} from "./repository-contracts";
import { steamStorageCountries } from "./steam-policy";
import { CONNECTOR_PROVIDERS } from "./types";

export async function getStudioOverview(
  actorEmail: string,
): Promise<StudioOverview> {
  const database = databaseOrNull();
  if (!database) {
    return {
      status: "database_setup_required",
      reason: "binding_unavailable",
      encryptionConfigured: Boolean(runtimeValue("CONNECTOR_ENCRYPTION_KEY")),
      steamStorageCountries: steamStorageCountries(),
      connectors: CONNECTOR_PROVIDERS.map(placeholderHealth),
    };
  }

  try {
    const now = new Date().toISOString();

    const publicationRows = await database
      .prepare(
        `SELECT publication_state AS publicationState, COUNT(*) AS count
         FROM public_records
         GROUP BY publication_state`,
      )
      .all<{ publicationState: string; count: number }>();

    const publicationCounts = Object.fromEntries(
      (publicationRows.results ?? []).map((row) => [
        row.publicationState,
        asCount(row.count),
      ]),
    );

    const connectors: ConnectorHealth[] = [];
    for (const provider of CONNECTOR_PROVIDERS) {
      const credential = await database
        .prepare(
          `SELECT provider, credential_label AS credentialLabel,
                  expires_at AS credentialExpiresAt,
                  created_at AS authorizedAt, updated_at AS updatedAt
           FROM connector_credentials
           WHERE provider = ?
           LIMIT 1`,
        )
        .bind(provider)
        .first<{
          provider: string;
          credentialLabel: string;
          credentialExpiresAt: string | null;
          authorizedAt: string;
          updatedAt: string;
        }>();
      const snapshot = await database
        .prepare(
          `SELECT status, fetched_at AS fetchedAt, fresh_until AS freshUntil,
                  item_count AS itemCount
           FROM connector_snapshots
           WHERE provider = ?
           ORDER BY fetched_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{
          status: string;
          fetchedAt: string;
          freshUntil: string;
          itemCount: number;
        }>();
      const run = await database
        .prepare(
          `SELECT status, error_code AS errorCode, started_at AS startedAt,
                  finished_at AS finishedAt
           FROM sync_runs
           WHERE provider = ?
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .bind(provider)
        .first<{
          status: string;
          errorCode: string | null;
          startedAt: string;
          finishedAt: string | null;
        }>();
      const pendingAuthorization =
        provider === "myanimelist" ||
        provider === "spotify" ||
        provider === "discogs"
          ? await database
              .prepare(
                `SELECT state_hash AS stateHash
                 FROM connector_oauth_transactions
                 WHERE provider = ?
                   AND owner_email = ?
                   AND consumed_at IS NULL
                   AND expires_at > ?
                 LIMIT 1`,
              )
              .bind(provider, normalizedOwnerEmail(actorEmail), now)
              .first<{ stateHash: string }>()
          : null;
      const providerRetryNotBefore =
        provider === "discogs"
          ? await discogsRetryNotBefore(database, Date.parse(now))
          : null;
      const retryCandidates =
        provider === "discogs"
          ? [providerRetryNotBefore, snapshot?.freshUntil ?? null]
              .filter(
                (value): value is string =>
                  Boolean(value) && Date.parse(value as string) > Date.parse(now),
              )
              .sort((left, right) => Date.parse(right) - Date.parse(left))
          : [];
      const retryNotBefore = retryCandidates[0] ?? null;

      const configured = Boolean(credential);
      const stale = snapshot
        ? Date.parse(snapshot.freshUntil) <= Date.now()
        : false;
      let status: ConnectorHealth["status"] = "never_synced";
      if (provider === "steam" && !steamStorageCountries()) {
        status = "setup_required";
      } else if (!configured && pendingAuthorization) {
        status = "authorization_required";
      } else if (!configured) status = "setup_required";
      else if (run?.status === "running") status = "syncing";
      else if (
        provider === "steam" &&
        (snapshot?.status === "withheld" || run?.status === "withheld")
      ) {
        status = "visibility_required";
      } else if (
        run?.status === "failed" &&
        run.errorCode === "reauthorization_required" &&
        (!credential?.updatedAt ||
          !run.finishedAt ||
          Date.parse(run.finishedAt) >= Date.parse(credential.updatedAt))
      ) {
        status = "reauthorization_required";
      } else if (
        run?.status === "failed" &&
        (!credential?.updatedAt ||
          !run.finishedAt ||
          Date.parse(run.finishedAt) >= Date.parse(credential.updatedAt))
      ) {
        status = "error";
      }
      else if (snapshot?.status === "ready" && stale) status = "stale";
      else if (snapshot?.status === "ready") status = "healthy";

      connectors.push({
        provider,
        configured,
        canReuseOAuthClient:
          (provider === "myanimelist" ||
            provider === "spotify" ||
            provider === "discogs") &&
          credential?.credentialLabel === "Owner OAuth authorization",
        status,
        lastSyncedAt: snapshot?.fetchedAt ?? null,
        freshUntil: snapshot?.freshUntil ?? null,
        credentialExpiresAt: credential?.credentialExpiresAt ?? null,
        authorizedAt: credential?.authorizedAt ?? null,
        lastRunStatus: run?.status ?? null,
        lastErrorCode: run?.errorCode ?? null,
        retryNotBefore,
        itemCount:
          snapshot?.status === "ready" ? asCount(snapshot.itemCount) : null,
      });
    }

    const latestPublication = await database
      .prepare(
        `SELECT id, content_hash AS contentHash, record_count AS recordCount,
                created_at AS publishedAt
         FROM publication_snapshots
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .first<{
        id: string;
        contentHash: string;
        recordCount: number;
        publishedAt: string;
      }>();

    return {
      status: "ready",
      encryptionConfigured: Boolean(runtimeValue("CONNECTOR_ENCRYPTION_KEY")),
      steamStorageCountries: steamStorageCountries(),
      publicationCounts,
      connectors,
      latestPublication: latestPublication
        ? {
            ...latestPublication,
            recordCount: asCount(latestPublication.recordCount),
          }
        : null,
    };
  } catch (error) {
    return {
      status: "database_setup_required",
      reason: classifyDatabaseError(error),
      encryptionConfigured: Boolean(runtimeValue("CONNECTOR_ENCRYPTION_KEY")),
      steamStorageCountries: steamStorageCountries(),
      connectors: CONNECTOR_PROVIDERS.map(placeholderHealth),
    };
  }
}
