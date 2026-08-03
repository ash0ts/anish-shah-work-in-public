import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const attestationPath = path.join(
  root,
  "content/public/anish-content.public.v1.attestation.json",
);
const artifactPaths = [
  "content/public/anish-content.public.v1.json",
  "content/schema/anish-content.schema.json",
  "types/content.ts",
  "content/curation/content-v1.1.json",
  "content/curation/public-claim-upgrades.v1.json",
  "content/curation/work-groups.v1.json",
  "content/presentation/metric-groups.v1.json",
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function buildGeneratorAttestation() {
  const contentModules = (
    await readdir(path.join(root, "scripts/content"), { recursive: true })
  )
    .filter((relativePath) => relativePath.endsWith(".mjs"))
    .map((relativePath) => `scripts/content/${relativePath}`)
    .sort();
  const modulePaths = [
    "scripts/build-content.mjs",
    "scripts/lib/csv.mjs",
    ...contentModules,
  ];
  const digest = createHash("sha256");
  for (const relativePath of modulePaths) {
    const bytes = await readFile(path.join(root, relativePath));
    digest.update(relativePath);
    digest.update("\0");
    digest.update(sha256(bytes));
    digest.update("\0");
  }
  return {
    moduleCount: modulePaths.length,
    sha256: digest.digest("hex"),
  };
}

async function buildAttestation() {
  const artifacts = await Promise.all(
    artifactPaths.map(async (relativePath) => {
      const bytes = await readFile(path.join(root, relativePath));
      return {
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
  );
  const publicBundle = JSON.parse(
    await readFile(path.join(root, artifactPaths[0]), "utf8"),
  );
  const generator = await buildGeneratorAttestation();

  return {
    schemaVersion: "1.0",
    contentVersion: publicBundle.contentVersion,
    generatedAt: publicBundle.generatedAt,
    artifacts,
    generator,
    counts: {
      items: publicBundle.items.length,
      entities: publicBundle.entities.length,
      workGroups: publicBundle.workGroups.length,
      metrics: publicBundle.metrics.length,
      metricGroups: publicBundle.metricGroups.length,
      evidence: publicBundle.evidence.length,
      relations: publicBundle.relations.length,
      collections: publicBundle.collections.length,
      narratives: publicBundle.narratives.length,
      sourceSnapshots: publicBundle.sourceSnapshots.length,
    },
    sourceSummary: publicBundle.sourceSummary,
  };
}

const serialized = `${JSON.stringify(await buildAttestation(), null, 2)}\n`;

if (process.argv.includes("--write")) {
  await mkdir(path.dirname(attestationPath), { recursive: true });
  const temporaryPath = `${attestationPath}.tmp`;
  await writeFile(temporaryPath, serialized, { mode: 0o644 });
  await rename(temporaryPath, attestationPath);
  console.log(
    `Wrote ${path.relative(root, attestationPath)} for public content only.`,
  );
} else if (process.argv.includes("--check")) {
  const current = await readFile(attestationPath, "utf8").catch(() => null);
  if (current !== serialized) {
    throw new Error(
      "Public content attestation is missing or stale. Regenerate private-source content first, then run npm run content:attest:write.",
    );
  }
  console.log("Public content attestation matches every deployable content input.");
} else {
  throw new Error("Use --check or --write.");
}
