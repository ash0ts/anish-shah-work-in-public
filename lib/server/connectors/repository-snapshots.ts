import {
  discogsExtendedDisplayApprovalIsActive,
  getDiscogsExtendedDisplayApproval,
  getDiscogsPresentationConfig,
} from "./discogs-presentation";
import { getSpotifyPresentationConfig } from "./spotify-presentation";
import { parseStoredConnectorPublicPayload } from "./public-payload-policy";
import { databaseOrNull } from "./repository-primitives";
import type { PublicSnapshotResult } from "./repository-contracts";
import type { ConnectorProvider } from "./types";

const STEAM_MAX_PUBLIC_AGE_MS = 72 * 60 * 60 * 1000;
const SPOTIFY_MAX_PUBLIC_AGE_MS = 72 * 60 * 60 * 1000;
const DISCOGS_MAX_PUBLIC_AGE_MS = 6 * 60 * 60 * 1000;

function canonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export async function getPublicConnectorSnapshot(
  provider: ConnectorProvider,
): Promise<PublicSnapshotResult> {
  const database = databaseOrNull();
  if (!database) {
    return { status: "unavailable", provider, reason: "database_unavailable" };
  }

  if (provider === "spotify") {
    const presentation = await getSpotifyPresentationConfig();
    if (
      presentation.status !== "ready" ||
      !presentation.config.publishTopTracks
    ) {
      return {
        status: "unavailable",
        provider,
        reason: "visibility_withheld",
      };
    }
  }
  if (provider === "discogs") {
    const presentation = await getDiscogsPresentationConfig(database);
    if (
      presentation.status !== "ready" ||
      !presentation.config.publishCollection
    ) {
      return {
        status: "unavailable",
        provider,
        reason: "visibility_withheld",
      };
    }
  }

  const extendedDiscogsDisplay =
    provider === "discogs"
      ? await getDiscogsExtendedDisplayApproval(database).then(
          (result) =>
            result.status === "ready" &&
            discogsExtendedDisplayApprovalIsActive(result.approval),
        )
      : false;

  try {
    const snapshots = await database
      .prepare(
        `SELECT status, public_payload_json AS publicPayloadJson,
                fetched_at AS fetchedAt,
                fresh_until AS freshUntil
         FROM connector_snapshots
         WHERE provider = ?
         ORDER BY fetched_at DESC
         LIMIT 25`,
      )
      .bind(provider)
      .all<{
        status: string;
        publicPayloadJson: string;
        fetchedAt: string;
        freshUntil: string;
      }>();

    for (const snapshot of snapshots.results ?? []) {
      if (provider === "steam" && snapshot.status === "withheld") {
        return {
          status: "unavailable",
          provider,
          reason: "visibility_withheld",
        };
      }
      if (snapshot.status !== "ready") continue;

      const payload = parseStoredConnectorPublicPayload(
        provider,
        snapshot.publicPayloadJson,
      );
      if (!payload) continue;
      if (
        !canonicalIsoTimestamp(snapshot.fetchedAt) ||
        !canonicalIsoTimestamp(snapshot.freshUntil) ||
        payload.syncedAt !== snapshot.fetchedAt ||
        payload.freshUntil !== snapshot.freshUntil
      ) {
        continue;
      }
      if (
        provider === "steam" ||
        provider === "spotify" ||
        (provider === "discogs" && !extendedDiscogsDisplay)
      ) {
        const fetchedTime = Date.parse(snapshot.fetchedAt);
        if (
          !Number.isFinite(fetchedTime) ||
          Date.now() - fetchedTime >
            (provider === "steam"
              ? STEAM_MAX_PUBLIC_AGE_MS
              : provider === "spotify"
                ? SPOTIFY_MAX_PUBLIC_AGE_MS
                : DISCOGS_MAX_PUBLIC_AGE_MS)
        ) {
          return {
            status: "unavailable",
            provider,
            reason: "stale_expired",
          };
        }
      }

      return {
        status: "ready",
        provider,
        payload,
        fetchedAt: snapshot.fetchedAt,
        freshUntil: snapshot.freshUntil,
        stale: Date.parse(snapshot.freshUntil) <= Date.now(),
      };
    }

    if ((snapshots.results?.length ?? 0) === 0) {
      const credential = await database
        .prepare(
          `SELECT provider
           FROM connector_credentials
           WHERE provider = ?
           LIMIT 1`,
        )
        .bind(provider)
        .first();
      return {
        status: "unavailable",
        provider,
        reason: credential ? "never_synced" : "not_configured",
      };
    }

    return {
      status: "unavailable",
      provider,
      reason: "invalid_snapshot",
    };
  } catch {
    return { status: "unavailable", provider, reason: "database_unavailable" };
  }
}
