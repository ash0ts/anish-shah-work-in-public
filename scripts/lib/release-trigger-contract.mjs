import { PUBLIC_SITE_ORIGIN } from "./release-config-contract.mjs";

export const TRIGGER_RECEIPT_SCHEMA_VERSION = "1.0";
export const TRIGGER_RECEIPT_PATH = "dist/trigger-deployment.json";

export const DOMAIN_CUTOVER_SMOKE_TESTS = [
  "canonical_apex",
  "www_redirect",
  "workers_dev_disabled",
  "preview_urls_disabled",
  "request_id_header",
  "access_destinations",
];

export const DOMAIN_ACCESS_DESTINATIONS = [
  "anish-shah-is.online/studio*",
  "anish-shah-is.online/api/studio/*",
];

function canonicalIsoTimestamp(value, name) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp.`);
  }
  return value;
}

function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return value;
}

export function expectedNonVersionedTriggerSettings(config) {
  const canonicalHostname = new URL(PUBLIC_SITE_ORIGIN).hostname;
  const routes = config?.routes;
  const crons = config?.triggers?.crons;
  if (
    config?.name !== "anish-shah-work-in-public" ||
    config?.workers_dev !== false ||
    config?.preview_urls !== false ||
    !Array.isArray(routes) ||
    routes.length !== 1 ||
    routes[0]?.pattern !== canonicalHostname ||
    routes[0]?.custom_domain !== true ||
    JSON.stringify(crons) !== JSON.stringify(["17 * * * *"])
  ) {
    throw new Error(
      "Prepared Worker triggers do not match the exact domain-cutover contract.",
    );
  }
  return {
    workerName: config.name,
    canonicalOrigin: PUBLIC_SITE_ORIGIN,
    routes: [{ pattern: canonicalHostname, customDomain: true }],
    workersDev: false,
    previewUrls: false,
    crons: [...crons],
  };
}

export function createTriggerDeploymentReceipt({
  head,
  configSha256,
  config,
  appliedAt,
}) {
  if (!/^[a-f0-9]{40}$/.test(head ?? "")) {
    throw new Error("The trigger receipt requires the exact release commit SHA.");
  }
  return {
    schemaVersion: TRIGGER_RECEIPT_SCHEMA_VERSION,
    appliedAt: canonicalIsoTimestamp(appliedAt, "appliedAt"),
    commitSha: head,
    preparedWorkerConfigSha256: sha256(
      configSha256,
      "preparedWorkerConfigSha256",
    ),
    appliedBy: "wrangler_triggers_deploy",
    settings: expectedNonVersionedTriggerSettings(config),
  };
}

export function assertTriggerDeploymentReceipt(
  receipt,
  { head, configSha256, config, notBefore },
) {
  const expected = createTriggerDeploymentReceipt({
    head,
    configSha256,
    config,
    appliedAt: receipt?.appliedAt,
  });
  if (
    receipt?.schemaVersion !== expected.schemaVersion ||
    receipt?.commitSha !== expected.commitSha ||
    receipt?.preparedWorkerConfigSha256 !==
      expected.preparedWorkerConfigSha256 ||
    receipt?.appliedBy !== expected.appliedBy ||
    JSON.stringify(receipt?.settings) !== JSON.stringify(expected.settings)
  ) {
    throw new Error(
      "The non-versioned trigger receipt is missing, stale, or does not match this release.",
    );
  }
  if (
    notBefore &&
    Date.parse(canonicalIsoTimestamp(receipt.appliedAt, "appliedAt")) <
      Date.parse(canonicalIsoTimestamp(notBefore, "notBefore"))
  ) {
    throw new Error("The non-versioned triggers predate this release plan.");
  }
  return expected;
}
