import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUTHORITY_MAP_DOCUMENTS,
  checkDocumentation,
  PRODUCTION_SMOKE_CHECKS,
  REQUIRED_DOCUMENTS,
} from "../scripts/lib/docs-check.mjs";

async function writeDocumentationFixture(root) {
  const content = new Map(REQUIRED_DOCUMENTS.map((file) => [file, "# Reference\n"]));
  const authorityRows = AUTHORITY_MAP_DOCUMENTS.map((file, index) => {
    const relative = path.posix.relative("docs", file);
    const target = relative.startsWith(".") ? relative : `./${relative}`;
    return `| Audience ${index + 1} | Reference | [Authority ${index + 1}](${target}) | Boundary changes |`;
  });
  content.set(
    "docs/README.md",
    [
      "# Documentation authority map",
      "",
      "| Audience / task | Type | Canonical authority | Update trigger |",
      "| --- | --- | --- | --- |",
      ...authorityRows,
      "",
      "## Maintenance rule",
      "",
      "Keep each authority listed exactly once.",
    ].join("\n"),
  );
  content.set(
    "README.md",
    [
      "# Site",
      "Private Sites is reference/recovery only.",
      "[Documentation map](./docs/README.md)",
      "[Testing](./docs/testing.md)",
      "[Release](./docs/operations/release.md)",
    ].join("\n"),
  );
  content.set(
    "docs/testing.md",
    "# Testing\nnpm run setup:local\nOWNER_EMAILS=owner@test.local\nnpm run doctor\nnpm run validate\nnpm run validate:browser\nValidate Gitleaks CodeQL Browser Quality\n",
  );
  content.set(
    "docs/architecture/codebase-tour.md",
    [
      "# Codebase tour",
      ...[
        "System context",
        "Request lifecycle",
        "Content and state",
        "Play as progressive enhancement",
        "Repository map",
        "Connector boundary",
        "Travel boundary",
        "Simulation boundary",
        "Environment isolation",
        "Release path",
        "Architectural tradeoffs",
        "Where to go deeper",
      ].flatMap((heading) => [`## ${heading}`, "Reference."]),
      "content/public/anish-content.public.v1.json is generated.",
      "app/api/studio/** owns writes after an explicit owner action.",
      "Travel is not a connector. Scheduled retention is bounded.",
      "Validate, Gitleaks, CodeQL, and Browser Quality are exact-SHA evidence.",
    ].join("\n"),
  );
  content.set(
    "docs/architecture/my-room-2001.md",
    "# Room\nCapability-gated progressive enhancement with connector isolation.\n/play/watch /play/read /play/listen /play/collect /play/play /play/move /play/travel\n",
  );
  content.set(
    "docs/operations/bootstrap.md",
    "# Bootstrap\nOne-time production and staging setup requires explicit authorization.\n",
  );
  content.set(
    "docs/operations/staging.md",
    "# Environments\nLocal · PR preview · Staging · Production\nAccess is required.\n",
  );
  content.set(
    "docs/operations/previews.md",
    "# Previews\nAccess-protected synthetic previews are noindex.\n",
  );
  content.set(
    "docs/operations/release.md",
    `# Release\n${PRODUCTION_SMOKE_CHECKS.join(" ")}\nRELEASE_BROWSER_URL COPY_VERSION\nnpm run --silent release:smoke:list\n`,
  );
  content.set(
    "docs/play-connections.md",
    "# Connections\nnpm run setup:local\nOWNER_EMAILS=owner@test.local\nnpm run doctor\nDiscogs has a four-hour manual-refresh window; accepted snapshots have no age-based deletion or public cutoff.\n/api/connectors/myanimelist/oauth/callback\n/api/connectors/spotify/oauth/callback\n/api/connectors/discogs/oauth/callback\n",
  );
  content.set(
    "docs/copywriting.md",
    "# Copywriting\nEdit content/copy using $edit-anish-site-copy. Review the protected fields, synthetic preview, and implementation request.\n",
  );
  for (const [relativePath, source] of content) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${source.trim()}\n`);
  }
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({
      scripts: {
        "setup:local": "echo setup",
        doctor: "echo doctor",
        validate: "echo validate",
        "validate:browser": "echo browser",
        "release:smoke:list": "echo smoke",
      },
    })}\n`,
  );
}

test("docs:check accepts a complete authoritative documentation set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  const result = await checkDocumentation({ root });
  assert.deepEqual(result, {
    checked: REQUIRED_DOCUMENTS.length,
    issues: [],
    ok: true,
  });
});

test("docs:check rejects missing authorities and broken local links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  await writeFile(
    path.join(root, "README.md"),
    "# Site\n[Missing](./docs/not-real.md)\n",
  );
  const result = await checkDocumentation({ root });
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.includes("broken local link")),
    true,
  );
  assert.equal(
    result.issues.some((issue) => issue.includes("documentation map")),
    true,
  );
});

test("docs:check rejects machine-local paths and smoke-contract duplication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  const localPath = ["", "Users", "someone", "private"].join("/");
  await writeFile(
    path.join(root, "docs/architecture/overview.md"),
    `# Overview\n${localPath}\n${PRODUCTION_SMOKE_CHECKS[0]}\n`,
  );
  const result = await checkDocumentation({ root });
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.includes("machine-local path")),
    true,
  );
  assert.equal(
    result.issues.some((issue) => issue.includes("duplicates production smoke")),
    true,
  );
});

test("docs:check scans non-authoritative Markdown under docs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  await writeFile(
    path.join(root, "docs/extra-note.md"),
    "# Extra\n[Missing](./not-real.md)\n",
  );
  const result = await checkDocumentation({ root });
  assert.equal(result.ok, false);
  assert.equal(result.checked, REQUIRED_DOCUMENTS.length + 1);
  assert.equal(
    result.issues.some(
      (issue) => issue.includes("docs/extra-note.md") && issue.includes("orphaned"),
    ),
    true,
  );
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.includes("docs/extra-note.md") && issue.includes("broken local link"),
    ),
    true,
  );
});

test("docs:check validates local anchors, npm scripts, and repository script paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  await writeFile(
    path.join(root, "docs/architecture/overview.md"),
    [
      "# Overview",
      "[Missing section](#not-a-section)",
      "npm run unknown:check",
      "Run scripts/runner/not-present.sh for proof.",
      "",
    ].join("\n"),
  );
  const packageManifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  packageManifest.scripts.broken = "node scripts/not-present.mjs";
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(packageManifest)}\n`,
  );

  const result = await checkDocumentation({ root });
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.includes("broken local anchor")),
    true,
  );
  assert.equal(
    result.issues.some((issue) => issue.includes("unknown npm script")),
    true,
  );
  assert.equal(
    result.issues.some((issue) => issue.includes("scripts/runner/not-present.sh")),
    true,
  );
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.includes("package.json script broken") &&
        issue.includes("scripts/not-present.mjs"),
    ),
    true,
  );
});

test("docs:check rejects an incomplete authority map", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  const mapPath = path.join(root, "docs/README.md");
  const source = await readFile(mapPath, "utf8");
  await writeFile(
    mapPath,
    source
      .split("\n")
      .filter((line) => !line.includes("./architecture/codebase-tour.md"))
      .join("\n"),
  );

  const result = await checkDocumentation({ root });
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.includes("docs/architecture/codebase-tour.md") &&
        issue.includes("found 0"),
    ),
    true,
  );
});

test("docs:check scans every pull-request template", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  const template = path.join(
    root,
    ".github/PULL_REQUEST_TEMPLATE/operations.md",
  );
  await writeFile(template, "# Operations\nRun scripts/missing-review.sh.\n");

  const result = await checkDocumentation({ root });
  assert.equal(result.checked, REQUIRED_DOCUMENTS.length + 1);
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.includes(".github/PULL_REQUEST_TEMPLATE/operations.md") &&
        issue.includes("scripts/missing-review.sh"),
    ),
    true,
  );
});

test("docs:check rejects first-run instructions that run doctor before owner setup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anish-docs-check-"));
  await writeDocumentationFixture(root);
  await writeFile(
    path.join(root, "docs/testing.md"),
    "# Testing\nnpm run setup:local\nnpm run doctor\nOWNER_EMAILS=owner@test.local\nnpm run validate\nnpm run validate:browser\nValidate Gitleaks CodeQL Browser Quality\n",
  );
  const result = await checkDocumentation({ root });
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.includes("before doctor")),
    true,
  );
});

test("release documentation preserves the two-phase staging and current naming contracts", async () => {
  const [
    bootstrap,
    staging,
    release,
    testing,
    audio,
    audioManifest,
    repositoryMap,
  ] =
    await Promise.all([
      readFile(
        new URL("../docs/operations/bootstrap.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../docs/operations/staging.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../docs/operations/release.md", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../docs/testing.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/audio-production.md", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../content/presentation/experience-audio.v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../.agents/skills/maintain-anish-site/references/repository-map.md",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  const stage = staging.indexOf("npm run staging:stage");
  const checkpoint = staging.indexOf("npm run staging:checkpoint");
  const promote = staging.indexOf("npm run staging:deploy", checkpoint);
  const smoke = staging.indexOf("npm run staging:smoke", promote);
  assert.equal(stage >= 0 && stage < checkpoint, true);
  assert.equal(checkpoint < promote && promote < smoke, true);
  assert.match(staging, /candidate at 0%/);
  assert.match(staging, /release marker to D1/);
  assert.match(bootstrap, /Cloudflare error `10042`/);
  assert.match(bootstrap, /690e6286eb53a6df1bd0080633caf91f/);
  assert.match(staging, /STAGING_RC_TAG/);
  assert.match(staging, /leave the release pull request draft/);
  assert.doesNotMatch(staging, /export RELEASE_VERSION='2\.0\.0-rc\.1'/);
  assert.doesNotMatch(release, /export RELEASE_VERSION='2\.0\.0'/);
  assert.match(release, /require\('\.\/package\.json'\)\.version/);
  assert.match(release, /npm run --silent release:smoke:list/);
  assert.doesNotMatch(release, /release:smoke:list -- --travel-atlas-mode/);
  assert.match(testing, /schema-validated safe response projection/);
  assert.match(audio, /Read · Bedside Shelf/);
  assert.doesNotMatch(audioManifest, /Borrowed Shelf/);
  for (const pathname of [
    "/play/watch",
    "/play/read",
    "/play/listen",
    "/play/collect",
    "/play/play",
    "/play/move",
    "/play/travel",
  ]) {
    assert.match(repositoryMap, new RegExp(pathname.replaceAll("/", "\\/")));
  }
});
