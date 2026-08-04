import { PUBLIC_SITE_ORIGIN } from "../site-constants";
import {
  expectedHostedOrigin,
  hostedEnvironmentConfigured,
  validReleaseVersion,
} from "../deployment-environment";
import { runtimeDatabase, runtimeValue } from "./runtime-env";
import { RETENTION_MAINTENANCE_KEY } from "./maintenance-state";
import { COPY_VERSION } from "../copy";
import {
  getSimulationHealthSummary,
  simulationProviderApprovalDigest,
  type SimulationHealthSummary,
} from "./simulation/health";
import { getTravelHealth, type TravelHealth } from "./travel";
export {
  PUBLICATION_MAINTENANCE_KEY,
  recordMaintenanceState,
  RETENTION_MAINTENANCE_KEY,
} from "./maintenance-state";
const RETENTION_STALE_MS = 3 * 60 * 60 * 1000;
const CONNECTOR_PROVIDERS = [
  "myanimelist",
  "hardcover",
  "spotify",
  "discogs",
  "steam",
  "strava",
] as const;

type HealthConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

type MaintenanceRow = {
  status: string;
  checkedAt: string;
};

type SnapshotHealthRow = {
  provider: string;
  status: string;
  fetchedAt: string;
  freshUntil: string;
};

type MigrationRow = { name: string };
type StravaSettingRow = { valueJson: string };

export type StudioHealth = {
  status: "healthy" | "degraded" | "setup_required";
  checkedAt: string;
  releaseSha: string | null;
  releaseVersion: string | null;
  contentVersion: string | null;
  copyVersion: string;
  canonicalOrigin: {
    status: "ready" | "setup_required" | "not_applicable";
    expected: string;
  };
  migration: {
    status: "ready" | "setup_required";
    latestApplied: string | null;
  };
  retentionHeartbeat: {
    status: "current" | "stale" | "never_run" | "error";
    lastRunAt: string | null;
  };
  connectors: Array<{
    provider: HealthConnectorProvider;
    status: "current" | "stale" | "error" | "unavailable";
    lastSuccessfulAt: string | null;
  }>;
  simulation: SimulationHealthSummary & {
    providerApprovalDigest: string | null;
  };
  travel: TravelHealth & {
    mode: "disabled" | "atlas-v1";
  };
};

function travelMode(): "disabled" | "atlas-v1" {
  return runtimeValue("TRAVEL_ATLAS_MODE") === "atlas-v1"
    ? "atlas-v1"
    : "disabled";
}

function canonicalOriginState(): StudioHealth["canonicalOrigin"] {
  if (runtimeValue("AUTH_MODE") !== "cloudflare_access") {
    return { status: "not_applicable", expected: PUBLIC_SITE_ORIGIN };
  }
  const values = {
    DEPLOYMENT_TIER: runtimeValue("DEPLOYMENT_TIER"),
    PREVIEW_PR_NUMBER: runtimeValue("PREVIEW_PR_NUMBER"),
    SITE_URL: runtimeValue("SITE_URL"),
    PRODUCTION_SITE_URL: runtimeValue("PRODUCTION_SITE_URL"),
    PUBLIC_CONTENT_MODE: runtimeValue("PUBLIC_CONTENT_MODE"),
    RELEASE_VERSION: runtimeValue("RELEASE_VERSION"),
  };
  return {
    status: hostedEnvironmentConfigured(values) ? "ready" : "setup_required",
    expected: expectedHostedOrigin(values) ?? PUBLIC_SITE_ORIGIN,
  };
}

function deployedValue(name: "RELEASE_SHA" | "CONTENT_VERSION", pattern: RegExp) {
  const value = runtimeValue(name)?.toLowerCase() ?? null;
  return value && pattern.test(value) ? value : null;
}

function deployedReleaseVersion(): string | null {
  const value = runtimeValue("RELEASE_VERSION") ?? null;
  return validReleaseVersion(value ?? undefined) ? value : null;
}

function retentionState(row: MaintenanceRow | null) {
  const checkedAt = row?.checkedAt ?? null;
  const checkedTime = Date.parse(checkedAt ?? "");
  const status: StudioHealth["retentionHeartbeat"]["status"] =
    row?.status === "error"
      ? "error"
      : !row || !Number.isFinite(checkedTime)
        ? "never_run"
        : Date.now() - checkedTime > RETENTION_STALE_MS
          ? "stale"
          : "current";
  return { status, lastRunAt: checkedAt };
}

function connectorState(
  provider: HealthConnectorProvider,
  row: SnapshotHealthRow | undefined,
): StudioHealth["connectors"][number] {
  if (!row) return { provider, status: "unavailable", lastSuccessfulAt: null };
  if (row.status !== "ready") {
    return { provider, status: "error", lastSuccessfulAt: null };
  }
  const freshUntil = Date.parse(row.freshUntil);
  return {
    provider,
    status:
      Number.isFinite(freshUntil) && freshUntil > Date.now()
        ? "current"
        : "stale",
    lastSuccessfulAt: Number.isFinite(Date.parse(row.fetchedAt))
      ? row.fetchedAt
      : null,
  };
}

function stravaState(
  row: StravaSettingRow | null,
): StudioHealth["connectors"][number] {
  if (!row) {
    return { provider: "strava", status: "unavailable", lastSuccessfulAt: null };
  }
  try {
    const value = JSON.parse(row.valueJson) as Record<string, unknown>;
    const updatedAt =
      typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
        ? value.updatedAt
        : null;
    return {
      provider: "strava",
      status: value.embedStatus === "available" ? "current" : "unavailable",
      lastSuccessfulAt: updatedAt,
    };
  } catch {
    return { provider: "strava", status: "error", lastSuccessfulAt: null };
  }
}

export async function getStudioHealth(): Promise<StudioHealth> {
  const checkedAt = new Date().toISOString();
  const releaseSha = deployedValue("RELEASE_SHA", /^[a-f0-9]{40}$/);
  const releaseVersion = deployedReleaseVersion();
  const contentVersion = deployedValue("CONTENT_VERSION", /^[a-f0-9]{16}$/);
  const canonicalOrigin = canonicalOriginState();
  const travel = {
    ...(await getTravelHealth()),
    mode: travelMode(),
  } satisfies StudioHealth["travel"];
  const database = runtimeDatabase();
  const [simulationSummary, providerApprovalDigest] = await Promise.all([
    getSimulationHealthSummary(new Date(checkedAt), database),
    simulationProviderApprovalDigest(database),
  ]);
  const simulation = {
    ...simulationSummary,
    providerApprovalDigest,
  };
  if (!database) {
    return {
      status: "setup_required",
      checkedAt,
      releaseSha,
      releaseVersion,
      contentVersion,
      copyVersion: COPY_VERSION,
      canonicalOrigin,
      migration: { status: "setup_required", latestApplied: null },
      retentionHeartbeat: { status: "never_run", lastRunAt: null },
      connectors: CONNECTOR_PROVIDERS.map((provider) => ({
        provider,
        status: "unavailable",
        lastSuccessfulAt: null,
      })),
      simulation,
      travel,
    };
  }

  try {
    const [migration, retention, snapshots, strava] = await Promise.all([
      database
        .prepare(`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`)
        .first<MigrationRow>(),
      database
        .prepare(
          `SELECT status, checked_at AS checkedAt
           FROM maintenance_state
           WHERE key = ?
           LIMIT 1`,
        )
        .bind(RETENTION_MAINTENANCE_KEY)
        .first<MaintenanceRow>(),
      database
        .prepare(
          `SELECT snapshots.provider, snapshots.status,
                  snapshots.fetched_at AS fetchedAt,
                  snapshots.fresh_until AS freshUntil
           FROM connector_snapshots AS snapshots
           WHERE snapshots.fetched_at = (
             SELECT MAX(candidate.fetched_at)
             FROM connector_snapshots AS candidate
             WHERE candidate.provider = snapshots.provider
           )`,
        )
        .all<SnapshotHealthRow>(),
      database
        .prepare(
          `SELECT value_json AS valueJson
           FROM editorial_settings
           WHERE key = 'connector.strava.public_embed'
           LIMIT 1`,
        )
        .first<StravaSettingRow>(),
    ]);

    const safeMigrationName =
      migration && /^\d+_[a-z0-9_]+\.sql$/i.test(migration.name)
        ? migration.name
        : null;
    const retentionHeartbeat = retentionState(retention);
    const byProvider = new Map(
      (snapshots.results ?? [])
        .filter((row) => CONNECTOR_PROVIDERS.includes(row.provider as HealthConnectorProvider))
        .map((row) => [row.provider, row]),
    );
    const connectors = [
      ...CONNECTOR_PROVIDERS.filter((provider) => provider !== "strava").map(
        (provider) => connectorState(provider, byProvider.get(provider)),
      ),
      stravaState(strava),
    ];
    const setupRequired =
      !releaseSha ||
      !releaseVersion ||
      !contentVersion ||
      !safeMigrationName ||
      canonicalOrigin.status === "setup_required" ||
      (travel.mode === "atlas-v1" && !travel.configured);
    const degraded =
      retentionHeartbeat.status !== "current" ||
      connectors.some((connector) => connector.status === "error") ||
      (travel.mode === "atlas-v1" &&
        (travel.cleanupHeartbeat.status === "stale" ||
          travel.cleanupHeartbeat.status === "error"));
    return {
      status: setupRequired ? "setup_required" : degraded ? "degraded" : "healthy",
      checkedAt,
      releaseSha,
      releaseVersion,
      contentVersion,
      copyVersion: COPY_VERSION,
      canonicalOrigin,
      migration: {
        status: safeMigrationName ? "ready" : "setup_required",
        latestApplied: safeMigrationName,
      },
      retentionHeartbeat,
      connectors,
      simulation,
      travel,
    };
  } catch {
    return {
      status: "setup_required",
      checkedAt,
      releaseSha,
      releaseVersion,
      contentVersion,
      copyVersion: COPY_VERSION,
      canonicalOrigin,
      migration: { status: "setup_required", latestApplied: null },
      retentionHeartbeat: { status: "error", lastRunAt: null },
      connectors: CONNECTOR_PROVIDERS.map((provider) => ({
        provider,
        status: "unavailable",
        lastSuccessfulAt: null,
      })),
      simulation,
      travel,
    };
  }
}
