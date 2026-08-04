import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkDocumentation,
  PRODUCTION_SMOKE_CHECKS,
  REQUIRED_DOCUMENTS,
} from "../scripts/lib/docs-check.mjs";

async function writeDocumentationFixture(root) {
  const content = new Map(REQUIRED_DOCUMENTS.map((file) => [file, "# Reference\n"]));
  content.set(
    "README.md",
    [
      "# Site",
      "Private Sites is reference/recovery only.",
      "[Testing](./docs/testing.md)",
      "[Copywriting](./docs/copywriting.md)",
      "[Room](./docs/architecture/my-room-2001.md)",
      "npm run setup:local",
      "OWNER_EMAILS=owner@test.local",
      "npm run doctor",
    ].join("\n"),
  );
  content.set(
    "docs/testing.md",
    "# Testing\nnpm run setup:local\nOWNER_EMAILS=owner@test.local\nnpm run doctor\nnpm run validate\nnpm run validate:browser\nValidate Gitleaks CodeQL Browser Quality\n",
  );
  content.set(
    "docs/architecture/my-room-2001.md",
    "# Room\nCapability-gated progressive enhancement with connector isolation.\n/play/watch /play/read /play/listen /play/collect /play/play /play/move /play/travel\n",
  );
  content.set(
    "docs/operations/staging-and-previews.md",
    "# Environments\nLocal · PR preview · Live staging · Production\nAccess, noindex, synthetic fixtures.\n",
  );
  content.set(
    "docs/operations/release.md",
    `# Release\n${PRODUCTION_SMOKE_CHECKS.join(" ")}\nRELEASE_BROWSER_URL COPY_VERSION\n`,
  );
  content.set(
    "docs/play-connections.md",
    "# Connections\nnpm run setup:local\nOWNER_EMAILS=owner@test.local\nnpm run doctor\nDiscogs has a four-hour refresh and six-hour cutoff.\n/api/connectors/myanimelist/oauth/callback\n/api/connectors/spotify/oauth/callback\n/api/connectors/discogs/oauth/callback\n",
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
    result.issues.some((issue) => issue.includes("authoritative testing")),
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
      (issue) =>
        issue.includes("docs/extra-note.md") && issue.includes("broken local link"),
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
