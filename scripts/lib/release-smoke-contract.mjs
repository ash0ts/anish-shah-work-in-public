import { requiredPlaySmokeTests } from "./release-contract.mjs";
import { DOMAIN_CUTOVER_SMOKE_TESTS } from "./release-trigger-contract.mjs";

export const BASE_RELEASE_SMOKE_TESTS = Object.freeze([
  "public_routes",
  "studio_access",
  "non_owner_denial",
  "connector_galleries",
  "oauth_callbacks",
  "security_headers",
  "owner_health",
  "simulation_experience",
  ...DOMAIN_CUTOVER_SMOKE_TESTS,
]);

export function requiredReleaseSmokeTests({ travelAtlasMode }) {
  if (!new Set(["disabled", "atlas-v1"]).has(travelAtlasMode)) {
    throw new Error(
      "Travel Atlas mode must be disabled or atlas-v1 to list release smoke tests.",
    );
  }
  return requiredPlaySmokeTests(BASE_RELEASE_SMOKE_TESTS, {
    travelEnabled: travelAtlasMode === "atlas-v1",
  });
}
