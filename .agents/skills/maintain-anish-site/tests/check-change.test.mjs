import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { verifyAttestedArtifacts } from "../scripts/content-attestation-policy.mjs";
import { scanSensitiveContent } from "../scripts/sensitive-content.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDirectory, "../../../..");
const helper = path.join(
  root,
  ".agents/skills/maintain-anish-site/scripts/check-change.mjs",
);

function plan(...paths) {
  const args = [helper, "--plan"];
  for (const value of paths) args.push("--path", value);
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function git(directory, ...args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, output(result));
}

function deletedPathPlan(relativePath, content = "fixture\n") {
  const directory = mkdtempSync(path.join(tmpdir(), "anish-skill-delete-"));
  mkdirSync(path.dirname(path.join(directory, relativePath)), { recursive: true });
  writeFileSync(path.join(directory, relativePath), content);
  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "fixture@example.com");
  git(directory, "config", "user.name", "Fixture");
  git(directory, "add", relativePath);
  git(directory, "commit", "--quiet", "-m", "fixture");
  rmSync(path.join(directory, relativePath));
  const result = spawnSync(process.execPath, [helper, "--plan"], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  rmSync(directory, { recursive: true, force: true });
  return result;
}

test("content source edits select canonical content and attestation checks", () => {
  const result = plan("content/curation/work-groups.v1.json");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /npm run verify:content/);
  assert.match(result.stdout, /npm run content:attest/);
  assert.match(result.stdout, /npm run test:content/);
  assert.match(result.stdout, /npm run typecheck/);
});

test("owner OAuth and write routes require a security regression test", () => {
  const missingTest = plan(
    "app/api/studio/connectors/spotify/oauth/start/route.ts",
  );
  assert.equal(missingTest.status, 1);
  assert.match(
    output(missingTest),
    /Owner write\/auth\/OAuth code changed without a security or connector regression test/,
  );

  const covered = plan(
    "app/api/studio/connectors/spotify/oauth/start/route.ts",
    "tests/content-spotify-oauth.test.mjs",
  );
  assert.equal(covered.status, 0, output(covered));
  assert.match(covered.stdout, /npm run test:backend/);
});

test("responsive Spotify changes require the browser quality gate", () => {
  const result = plan("components/spotify/RankedGroove.tsx");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /npm run validate:browser/);
});

test("Access and authentication changes fail classification without coverage", () => {
  const missingTest = plan("worker/access.ts");
  assert.equal(missingTest.status, 1);
  assert.match(
    output(missingTest),
    /Owner write\/auth\/OAuth code changed without a security or connector regression test/,
  );

  const covered = plan("worker/access.ts", "tests/cloudflare-access.test.mjs");
  assert.equal(covered.status, 0, output(covered));
  assert.match(covered.stdout, /npm run test:backend/);
  assert.match(covered.stdout, /npm run bundle:scan/);
});

test("known tokens and private-source references are rejected", () => {
  const githubToken = ["ghp", "A".repeat(40)].join("_");
  const localPath = ["", "Users", "alice", "Documents", "private-notes.md"].join(
    "/",
  );
  const findings = scanSensitiveContent(
    "docs/copied-notes.md",
    `token=${githubToken}\nsource=${localPath}\n`,
  );
  assert.match(findings.join("\n"), /GitHub token/);
  assert.match(findings.join("\n"), /machine-local home path/);

  const privateEvidence = scanSensitiveContent(
    "notes/copied-snapshot.json",
    JSON.stringify({ access: "owner_private" }),
  );
  assert.match(privateEvidence.join("\n"), /private evidence access marker/);
});

test("documented placeholders and synthetic negative fixtures are accepted", () => {
  assert.deepEqual(
    scanSensitiveContent(
      ".env.example",
      "CONNECTOR_ENCRYPTION_KEY=<base64-encoded-32-byte-key>\nRATE_LIMIT_SALT=${LOCAL_ONLY_VALUE}\n",
    ),
    [],
  );
  const examplePrivatePath = ["file:", "", "", "Users", "example", "private"].join(
    "/",
  );
  assert.deepEqual(
    scanSensitiveContent(
      "tests/privacy.test.mjs",
      `const source = "${examplePrivatePath}";\nconst token = "safe-test-token";\n`,
    ),
    [],
  );
});

test("literal high-entropy credential assignments are rejected", () => {
  const credential = ["8f39", "A7c2", "91bd", "EE43", "0a7f", "6C11"].join("");
  const findings = scanSensitiveContent(
    "config/deploy.yml",
    `client_secret: ${credential}\n`,
  );
  assert.match(findings.join("\n"), /literal credential value/);
});

test("generated public content requires a matching attestation change", () => {
  const result = plan("content/public/anish-content.public.v1.json");
  assert.equal(result.status, 1);
  assert.match(
    output(result),
    /Generated public content changed without a matching checked-in content attestation update/,
  );
});

test("edited generated content must match the claimed attestation hash", () => {
  const artifactPath = "content/public/example.json";
  const violations = verifyAttestedArtifacts(
    JSON.stringify({
      artifacts: [{ path: artifactPath, bytes: 2, sha256: "0".repeat(64) }],
    }),
    new Map([[artifactPath, "{}"]]),
  );
  assert.deepEqual(violations, [
    `${artifactPath} does not match its attested bytes and SHA-256.`,
  ]);
});

test("applied migrations are immutable", () => {
  const result = plan("drizzle/0004_shallow_spitfire.sql");
  assert.equal(result.status, 1);
  assert.match(output(result), /applied migrations are immutable/);
});

test("deleting an applied migration is rejected", () => {
  const result = deletedPathPlan("drizzle/0001_applied.sql", "SELECT 1;\n");
  assert.equal(result.status, 1);
  assert.match(output(result), /applied migrations are immutable/);
});

test("deleting the public attestation is rejected", () => {
  const result = deletedPathPlan(
    "content/public/anish-content.public.v1.attestation.json",
    "{}\n",
  );
  assert.equal(result.status, 1);
  assert.match(output(result), /attestation or an attested artifact is unreadable/);
});

test("deleting security coverage without replacement is rejected", () => {
  const result = deletedPathPlan(
    "tests/security-hardening.test.mjs",
    "// fixture\n",
  );
  assert.equal(result.status, 1);
  assert.match(output(result), /Security regression coverage was deleted without replacement/);
});

test("deleting mistakenly tracked sensitive material is allowed", () => {
  const result = deletedPathPlan(".env", "API_KEY=unsafe-fixture-value\n");
  assert.equal(result.status, 0, output(result));
});

test("release work selects validation without production mutation", () => {
  const result = plan("releases/next-release.json");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /npm run validate:release/);
  assert.match(
    result.stdout,
    /Release validation never deploys, migrates production, rotates credentials, or mutates Git/,
  );
  assert.doesNotMatch(result.stdout, /cloudflare:deploy|cloudflare:migrate/);
});

test("release gate implementation changes always select full release validation", () => {
  for (const gate of [
    "scripts/lib/release-config-contract.mjs",
    "scripts/lib/deployable-artifact-contract.mjs",
    "scripts/deployable-artifact-manifest.mjs",
    "scripts/check-codeql-sarif.mjs",
    "scripts/run-lighthouse-quality.mjs",
  ]) {
    const result = plan(gate);
    assert.equal(result.status, 0, `${gate}\n${output(result)}`);
    assert.match(result.stdout, /npm run validate:release/, gate);
    assert.doesNotMatch(result.stdout, /cloudflare:deploy|cloudflare:migrate/, gate);
  }
});
