import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyCopyOnlyPackage,
  classifyCopyChanges,
  copyPreviewComment,
  parseCopyOnlyPackage,
} from "../scripts/lib/copy-only-lane.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const repository = "ash0ts/anish-shah-work-in-public";

function copyPackage() {
  const bytes = Buffer.from("Trusted plain text.\n", "utf8");
  return {
    schemaVersion: "1.0",
    repository,
    pullRequestNumber: 26,
    baseSha,
    mergeBaseSha: "c".repeat(40),
    headSha,
    copyVersion: "d".repeat(16),
    files: [
      {
        path: "content/copy/pages/home.md",
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        contentBase64: bytes.toString("base64"),
      },
    ],
    changes: [
      {
        key: "home.hero-headline",
        risk: "editorial",
        route: "/",
        beforeLength: 18,
        afterLength: 19,
      },
    ],
    affectedRoutes: ["/"],
  };
}

const expected = {
  repository,
  prNumber: 26,
  baseSha,
  headSha,
};

test("copy-only classification accepts only modified declared Markdown files", () => {
  assert.deepEqual(
    classifyCopyChanges([
      { status: "modified", filename: "content/copy/pages/home.md" },
      { status: "modified", filename: "content/copy/pages/simulation.md" },
      {
        status: "M",
        path: "content/copy/work-groups/wandb-mcp-server.md",
      },
    ]),
    {
      eligible: true,
      reason: "copy_only",
      paths: [
        "content/copy/pages/home.md",
        "content/copy/pages/simulation.md",
        "content/copy/work-groups/wandb-mcp-server.md",
      ],
    },
  );

  for (const entry of [
    { status: "added", filename: "content/copy/pages/home.md" },
    { status: "removed", filename: "content/copy/pages/home.md" },
    { status: "renamed", filename: "content/copy/pages/home.md" },
    { status: "modified", filename: "content/copy/README.md" },
    { status: "modified", filename: "content/copy/pages/new-page.md" },
    { status: "modified", filename: "content/copy/pages/../home.md" },
    { status: "modified", filename: "app/page.tsx" },
    { status: "modified", filename: ".github/workflows/validate.yml" },
    { status: "modified", filename: "package.json" },
  ]) {
    assert.deepEqual(classifyCopyChanges([entry]), {
      eligible: false,
      reason: "non_copy_or_structural_change",
      paths: [],
    });
  }
});

test("copy-only package parsing rejects path, integrity, shape, and PR mismatches", () => {
  const valid = copyPackage();
  const parsed = parseCopyOnlyPackage(valid, expected);
  assert.equal(parsed.files[0].bytes.toString("utf8"), "Trusted plain text.\n");

  const forbiddenPath = structuredClone(valid);
  forbiddenPath.files[0].path = "app/page.tsx";
  assert.throws(
    () => parseCopyOnlyPackage(forbiddenPath, expected),
    /forbidden path/u,
  );

  const invalidDigest = structuredClone(valid);
  invalidDigest.files[0].sha256 = "0".repeat(64);
  assert.throws(
    () => parseCopyOnlyPackage(invalidDigest, expected),
    /integrity validation/u,
  );

  const unknownField = structuredClone(valid);
  unknownField.untrusted = true;
  assert.throws(
    () => parseCopyOnlyPackage(unknownField, expected),
    /unexpected shape/u,
  );

  assert.throws(
    () =>
      parseCopyOnlyPackage(valid, {
        ...expected,
        headSha: "e".repeat(40),
      }),
    /does not match the current pull request/u,
  );
});

test("trusted apply rejects a downloaded package symlink before reading Git state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "copy-only-lane-"));
  try {
    const target = path.join(directory, "target.json");
    const link = path.join(directory, "package.json");
    await writeFile(target, `${JSON.stringify(copyPackage())}\n`, { mode: 0o600 });
    await symlink(target, link);
    await assert.rejects(
      applyCopyOnlyPackage({
        packagePath: link,
        baseRoot: directory,
        expected,
        reportPath: path.join(directory, "report.json"),
      }),
      /must be a regular file/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("trusted copy preview comments identify exact bytes and review risk", () => {
  const body = copyPreviewComment({
    report: {
      baseSha,
      headSha,
      copyVersion: "d".repeat(16),
      changes: [
        {
          key: "home.hero-headline",
          risk: "editorial",
          route: "/",
        },
        {
          key: "group:products:wandb-mcp.summary",
          risk: "fact_check",
          route: "/work/wandb-mcp-server",
        },
      ],
      affectedRoutes: ["/", "/work/wandb-mcp-server"],
    },
    previewUrl: "https://pr-26.anish-shah-is.online",
    screenshot: { status: "passed", captured: 4, total: 4 },
  });
  assert.match(body, new RegExp(headSha, "u"));
  assert.match(body, new RegExp(baseSha, "u"));
  assert.match(body, /COPY_VERSION: `d{16}`/u);
  assert.match(body, /Editorial keys: `home\.hero-headline`/u);
  assert.match(body, /Fact-check keys: `group:products:wandb-mcp\.summary`/u);
  assert.match(body, /Data: synthetic; no production connector or Studio access/u);
  assert.match(body, /Screenshots: passed \(4\/4 affected route-viewports\)/u);
});

test("copy-only workflows preserve the unprivileged-to-trusted execution boundary", async () => {
  const [validation, trusted, normal, cleanup, setupAction] = await Promise.all([
    readFile(path.join(root, ".github/workflows/copy-only-validate.yml"), "utf8"),
    readFile(path.join(root, ".github/workflows/copy-preview-deploy.yml"), "utf8"),
    readFile(path.join(root, ".github/workflows/preview-deploy.yml"), "utf8"),
    readFile(path.join(root, ".github/workflows/preview-cleanup.yml"), "utf8"),
    readFile(path.join(root, ".github/actions/setup-repository/action.yml"), "utf8"),
  ]);

  assert.doesNotMatch(validation, /pull_request_target/u);
  assert.match(validation, /permissions:\n  contents: read/u);
  assert.doesNotMatch(validation, /environment:/u);
  assert.doesNotMatch(validation, /secrets\./u);
  assert.match(validation, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(validation, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(validation, /path: \.copy-preview\/package\.json/u);
  assert.match(
    validation,
    /Upload only validated plain-text copy[\s\S]*path: \.copy-preview\/package\.json/u,
  );
  assert.doesNotMatch(validation, /Upload only validated plain-text copy[\s\S]*path: dist/u);

  assert.match(trusted, /workflow_run:/u);
  assert.match(trusted, /ref: \$\{\{ github\.workflow_sha \}\}/u);
  assert.match(trusted, /fetch-depth: 0/u);
  assert.match(trusted, /environment: copy-preview/u);
  assert.match(trusted, /group: preview-pr-/u);
  assert.match(trusted, /uses: \.\/trusted\/\.github\/actions\/setup-repository/u);
  assert.match(trusted, /working-directory: site/u);
  assert.match(setupAction, /npm ci --ignore-scripts --prefix/u);
  assert.match(trusted, /Check out exact base code[\s\S]*ref: \$\{\{ needs\.inspect\.outputs\.base_sha \}\}/u);
  assert.match(trusted, /Check out pristine base for trusted comparison[\s\S]*ref: \$\{\{ needs\.inspect\.outputs\.base_sha \}\}/u);
  assert.doesNotMatch(trusted, /ref: \$\{\{ needs\.inspect\.outputs\.head_sha \}\}/u);
  assert.match(trusted, /node trusted\/scripts\/copy-only-lane\.mjs apply/u);
  assert.match(trusted, /PREVIEW_SOURCE_SHA: \$\{\{ needs\.inspect\.outputs\.head_sha \}\}/u);
  assert.match(trusted, /Recheck exact head and base before privileged deployment/u);
  assert.match(trusted, /test "\$base_ref" = "\$default_branch"/u);
  assert.match(trusted, /git merge-base --is-ancestor "\$base_sha"/u);
  assert.match(trusted, /A newer head, changed base, or closed PR superseded this failed validation/u);
  assert.match(trusted, /A newer head, changed base, or closed PR superseded this preview result/u);
  assert.match(trusted, /mark_deploy_failed:/u);
  assert.match(trusted, /Any older preview is stale and must not be reviewed/u);

  assert.match(normal, /route preview lane with trusted code/u);
  assert.match(normal, /needs\.inspect\.outputs\.copy_only != 'true'/u);
  assert.match(normal, /environment: preview/u);
  assert.doesNotMatch(normal, /environment: copy-preview/u);
  assert.match(normal, /group: preview-\$\{\{[\s\S]*format\('pr-\{0\}'/u);
  assert.match(cleanup, /group: preview-\$\{\{[\s\S]*format\('pr-\{0\}'/u);
});
