#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requiredReleaseSmokeTests } from "./lib/release-smoke-contract.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function releaseSmokeTestsFromPreparedPlan(root = defaultRoot) {
  const [planBytes, configBytes] = await Promise.all([
    readFile(path.join(root, "dist/release-plan.json")),
    readFile(path.join(root, "dist/server/wrangler.public.json")),
  ]);
  const plan = JSON.parse(planBytes.toString("utf8"));
  const config = JSON.parse(configBytes.toString("utf8"));
  if (
    plan?.schemaVersion !== "1.3" ||
    !/^[a-f0-9]{40}$/u.test(plan?.commitSha ?? "") ||
    plan?.checksums?.preparedWorkerConfigSha256 !== sha256(configBytes) ||
    config?.vars?.RELEASE_SHA !== plan.commitSha ||
    config?.vars?.TRAVEL_ATLAS_MODE !== plan.travelAtlasMode
  ) {
    throw new Error(
      "The prepared release plan is missing, stale, or does not match the Worker configuration.",
    );
  }
  return requiredReleaseSmokeTests({ travelAtlasMode: plan.travelAtlasMode });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv.length !== 2) {
    throw new Error("Use release-smoke-list.mjs with no arguments.");
  }
  console.log((await releaseSmokeTestsFromPreparedPlan()).join(","));
}
