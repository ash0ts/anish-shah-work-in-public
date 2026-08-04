import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPreviewConfiguration,
  assertStagingConfiguration,
  expectedPreviewCoordinates,
  expectedStagingCoordinates,
  previewConfiguration,
  stagingConfiguration,
} from "./lib/hosted-config-contract.mjs";
import { matchingReleaseVersion, readPackageReleaseVersion } from "./lib/release-version.mjs";

const tier = process.argv[2];
if (tier !== "staging" && tier !== "preview") {
  throw new Error("Usage: node scripts/prepare-hosted-environment.mjs <staging|preview>");
}
if (process.env.LOCAL_OWNER_EMAIL?.trim()) {
  throw new Error("LOCAL_OWNER_EMAIL must not be present in a hosted release shell.");
}
const root = process.cwd();
const sourcePath = path.join(root, "dist/server/wrangler.json");
await access(sourcePath).catch(() => {
  throw new Error("Run the production build before preparing hosted configuration.");
});
const [base, bundle, packageVersion] = await Promise.all([
  readFile(sourcePath, "utf8").then(JSON.parse),
  readFile(
    tier === "preview"
      ? path.join(root, "dist/preview-metadata.json")
      : path.join(root, "content/public/anish-content.public.v1.json"),
    "utf8",
  ).then(JSON.parse),
  readPackageReleaseVersion(root),
]);
const environment = tier === "staging"
  ? { ...process.env, RELEASE_VALIDATED_SHA: process.env.STAGING_VALIDATED_SHA }
  : process.env;
if (
  tier === "preview" &&
  (bundle.schemaVersion !== "1.2" ||
    bundle.syntheticConnectorData !== true ||
    bundle.releaseSha !== process.env.RELEASE_VALIDATED_SHA?.trim().toLowerCase() ||
    bundle.sourceSha !== bundle.releaseSha ||
    !/^[a-f0-9]{40}$/.test(bundle.workflowSha ?? "") ||
    bundle.prNumber !== process.env.PREVIEW_PR_NUMBER?.trim() ||
    bundle.releaseVersion !== packageVersion)
) {
  throw new Error("The preview artifact metadata does not match this PR and SHA.");
}
const expected = tier === "staging"
  ? expectedStagingCoordinates(environment, bundle.contentVersion, packageVersion)
  : expectedPreviewCoordinates(
      { ...process.env, RELEASE_VERSION: matchingReleaseVersion(bundle.releaseVersion, packageVersion) },
      bundle.contentVersion,
      packageVersion,
    );
const config = tier === "staging"
  ? stagingConfiguration(base, expected)
  : previewConfiguration(base, expected);
if (tier === "staging") assertStagingConfiguration(config, expected);
else assertPreviewConfiguration(config, expected);
const destination = path.join(root, `dist/server/wrangler.${tier}.json`);
await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`Prepared ${path.relative(root, destination)} without runtime secrets.`);
