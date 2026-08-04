import { getPublicationCheckpointFromStores } from "./publication-checkpoint";
import { validReleaseVersion } from "../deployment-environment";
import {
  recordMaintenanceState,
  RELEASE_PUBLICATION_MAINTENANCE_KEY,
} from "./maintenance-state";
import {
  runtimeDatabase,
  runtimePublicationKv,
  runtimeValue,
} from "./runtime-env";

export function getPublicationCheckpoint() {
  return getPublicationCheckpointFromStores(
    runtimeDatabase(),
    runtimePublicationKv(),
  );
}

export async function confirmReleasePublication() {
  const database = runtimeDatabase();
  const releaseSha = runtimeValue("RELEASE_SHA")?.toLowerCase() ?? "";
  const releaseVersion = runtimeValue("RELEASE_VERSION") ?? "";
  const contentVersion = runtimeValue("CONTENT_VERSION")?.toLowerCase() ?? "";
  if (
    !database ||
    !/^[a-f0-9]{40}$/.test(releaseSha) ||
    !validReleaseVersion(releaseVersion) ||
    !/^[a-f0-9]{16}$/.test(contentVersion)
  ) {
    throw new Error("Release metadata is unavailable.");
  }
  const checkpoint = await getPublicationCheckpoint();
  if (
    checkpoint.status !== "ready" ||
    checkpoint.contentVersion !== contentVersion ||
    !checkpoint.contentHash ||
    !checkpoint.kvPointerMatches
  ) {
    throw new Error("The active D1/KV publication is not release-ready.");
  }
  const verifiedAt = new Date().toISOString();
  const marker = {
    releaseSha,
    releaseVersion,
    contentVersion,
    contentHash: checkpoint.contentHash,
    verifiedAt,
  };
  await recordMaintenanceState(
    database,
    RELEASE_PUBLICATION_MAINTENANCE_KEY,
    "ready",
    marker,
    verifiedAt,
  );
  return marker;
}
