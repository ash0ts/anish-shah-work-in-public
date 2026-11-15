import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { buildDeployableArtifactManifest } from "./deployable-artifact-contract.mjs";
import { gitRead, digest } from "./release-coverage.mjs";

export async function validationIdentity(root, suite, inputs = {}) {
  const manifest = await buildDeployableArtifactManifest(root);
  const files = gitRead(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "scripts", "tests", "lib", "types", "app", "components", "content", "worker", "package.json", "package-lock.json", "playwright.config.mjs", "playwright.spotify-webkit.config.mjs"])
    .split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const filename = path.join(root, file);
    try {
      const stat = await lstat(filename);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Invalid validation input: ${file}`);
      hash.update(file).update("\0").update(await readFile(filename)).update("\0");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update(`${file}\0deleted\0`);
    }
  }
  return {
    schemaVersion: 1, suite, sourceSha: gitRead(root, ["rev-parse", "HEAD"]).trim(),
    artifactSha256: manifest.artifactSetSha256,
    configurationSha256: digest(manifest.artifacts.filter(({ path: name }) => /wrangler.*\.json$/.test(name))),
    suiteSha256: hash.digest("hex"), inputsSha256: digest({ inputs, environment: Object.fromEntries([
      "NODE_ENV", "CI", "DEPLOYMENT_TIER", "PUBLIC_CONTENT_MODE", "SITE_URL", "PRODUCTION_SITE_URL", "RELEASE_VERSION",
      "SIMULATION_EXPERIENCE_MODE", "SIMULATION_AI_MODE", "TRAVEL_ATLAS_MODE", "BROWSER_SIMULATION_EXPERIENCE_MODE",
    ].map((key) => [key, process.env[key] ?? null])) }),
    node: process.version, platform: process.platform, architecture: process.arch,
  };
}

export function reusableReceipt(receipt, identity) {
  return receipt?.status === "passed" && Number.isFinite(receipt.durationMs) && receipt.durationMs >= 0 &&
    JSON.stringify(receipt.identity) === JSON.stringify(identity);
}
