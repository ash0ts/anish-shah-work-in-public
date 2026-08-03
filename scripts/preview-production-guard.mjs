import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PUBLIC_CLOUDFLARE_ACCOUNT_ID,
  PUBLIC_SITE_ORIGIN,
} from "./lib/release-config-contract.mjs";

const PRODUCTION_WORKER_NAME = "anish-shah-work-in-public";
const productionHostname = new URL(PUBLIC_SITE_ORIGIN).hostname;
const wranglerPath = path.join(
  process.cwd(),
  "node_modules/wrangler/bin/wrangler.js",
);
const previewConfigPath = path.join(
  process.cwd(),
  "dist/server/wrangler.preview.json",
);
const action = process.argv[2];
const statePath = process.argv[3];

if (!new Set(["capture", "verify"]).has(action) || !statePath) {
  throw new Error(
    "Use preview-production-guard.mjs <capture|verify> <state-file>.",
  );
}

const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!cloudflareToken) throw new Error("CLOUDFLARE_API_TOKEN is required.");

function productionDeployment() {
  const result = spawnSync(
    process.execPath,
    [
      wranglerPath,
      "deployments",
      "status",
      "--config",
      previewConfigPath,
      "--name",
      PRODUCTION_WORKER_NAME,
      "--json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: PUBLIC_CLOUDFLARE_ACCOUNT_ID,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Unable to read the production Worker deployment (exit ${result.status}).`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Wrangler returned malformed production deployment JSON.");
  }
}

async function productionDomain() {
  const endpoint = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${PUBLIC_CLOUDFLARE_ACCOUNT_ID}/workers/domains`,
  );
  endpoint.searchParams.set("hostname", productionHostname);
  endpoint.searchParams.set("per_page", "100");
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${cloudflareToken}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true || !Array.isArray(body.result)) {
    throw new Error(
      `Unable to verify the production Custom Domain (HTTP ${response.status}).`,
    );
  }
  const matching = body.result.filter(
    (record) => record?.hostname === productionHostname,
  );
  if (
    matching.length !== 1 ||
    matching[0]?.service !== PRODUCTION_WORKER_NAME
  ) {
    throw new Error(
      "The production Custom Domain is missing or owned by an unexpected Worker.",
    );
  }
  const record = matching[0];
  return {
    id: record.id,
    hostname: record.hostname,
    service: record.service,
    environment: record.environment ?? null,
    zoneId: record.zone_id ?? null,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

async function snapshot() {
  return canonicalize({
    schemaVersion: "1.0",
    workerName: PRODUCTION_WORKER_NAME,
    deployment: productionDeployment(),
    domain: await productionDomain(),
  });
}

if (action === "capture") {
  await writeFile(statePath, `${JSON.stringify(await snapshot(), null, 2)}\n`, {
    mode: 0o600,
  });
  console.log("Captured the production Worker deployment and Custom Domain guard.");
} else {
  const before = canonicalize(JSON.parse(await readFile(statePath, "utf8")));
  const after = await snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      "Production Worker deployment or Custom Domain changed during preview deployment.",
    );
  }
  console.log("Production Worker deployment and Custom Domain are unchanged.");
}
