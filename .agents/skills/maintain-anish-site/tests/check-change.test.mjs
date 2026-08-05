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

function committedBasePlan() {
  const directory = mkdtempSync(path.join(tmpdir(), "anish-skill-base-"));
  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "fixture@example.com");
  git(directory, "config", "user.name", "Fixture");
  writeFileSync(path.join(directory, "README.md"), "# Fixture\n");
  git(directory, "add", "README.md");
  git(directory, "commit", "--quiet", "-m", "base");
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).stdout.trim();

  mkdirSync(path.join(directory, "content/copy/pages"), { recursive: true });
  writeFileSync(
    path.join(directory, "content/copy/pages/home.md"),
    "<!-- copy-page: home -->\n\n## hero-headline\nA useful headline\n",
  );
  git(directory, "add", "content/copy/pages/home.md");
  git(directory, "commit", "--quiet", "-m", "copy");

  const result = spawnSync(
    process.execPath,
    [helper, "--plan", "--base", base],
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  rmSync(directory, { recursive: true, force: true });
  return { base, result };
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

test("responsive Discogs changes require connector and browser gates", () => {
  const result = plan(
    "components/play/DiscogsStream.tsx",
    "lib/server/http/discogs-config.ts",
  );
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /npm run test:content/);
  assert.match(result.stdout, /npm run test:backend/);
  assert.match(result.stdout, /npm run validate:browser/);
});

test("copy-deck edits select copy validation and browser review", () => {
  const result = plan("content/copy/pages/home.md");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /- copy-deck/);
  assert.match(result.stdout, /npm run copy:check/);
  assert.match(result.stdout, /npm run copy:voice/);
  assert.match(result.stdout, /npm run copy:test/);
  assert.match(result.stdout, /npm run copy:diff/);
  assert.match(result.stdout, /npm run copy:audit/);
  assert.match(result.stdout, /owner-check every FACT-CHECK field/);
  assert.match(result.stdout, /npm run validate:browser/);
});

test("voice contracts and the copy skill select voice, audit, fact-check, and skill gates", () => {
  const result = plan(
    "lib/copy-voice-contract.ts",
    ".agents/skills/edit-anish-site-copy/SKILL.md",
  );
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /npm run copy:voice/);
  assert.match(result.stdout, /npm run copy:audit/);
  assert.match(result.stdout, /npm run skill:validate/);
  assert.match(result.stdout, /owner-check every FACT-CHECK field/);
});

test("mixed dependency and copy changes retain copy diff and browser gates", () => {
  const result = plan("package.json", "content/copy/pages/home.md");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /npm run validate/);
  assert.match(result.stdout, /npm run copy:diff/);
  assert.match(result.stdout, /npm run validate:browser/);
});

test("mixed dependency and documentation changes retain documentation coverage", () => {
  const result = plan("package.json", "README.md");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /- documentation/);
  assert.match(result.stdout, /npm run validate/);
});

test("local DX, documentation tooling, and skill tooling are classified", () => {
  for (const [pathName, expected] of [
    ["scripts/setup-local.mjs", /npm run test:local-dx/],
    ["scripts/lib/docs-check.mjs", /npm run docs:check/],
    ["scripts/validate-repository-skills.mjs", /npm run skill:validate/],
  ]) {
    const result = plan(pathName);
    assert.equal(result.status, 0, `${pathName}\n${output(result)}`);
    assert.match(result.stdout, /- developer-experience/);
    assert.match(result.stdout, expected);
  }
});

test("--base classifies committed changes from the requested merge base", () => {
  const { base, result } = committedBasePlan();
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, new RegExp(`Base: ${base}`));
  assert.match(result.stdout, /content\/copy\/pages\/home\.md/);
  assert.match(result.stdout, /- copy-deck/);
  assert.match(result.stdout, /npm run copy:diff -- --base [a-f0-9]{40}/);
  assert.match(result.stdout, /npm run copy:audit -- --base [a-f0-9]{40}/);
});

test("--base rejects Git-option injection", () => {
  const result = spawnSync(process.execPath, [helper, "--plan", "--base", "-p"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(output(result), /safe Git ref/);
});

test("every Travel source class selects the complete Travel validation gate", () => {
  for (const travelPath of [
    "scripts/travel/generate-geography.mjs",
    "public/assets/travel/geography/manifest.v1.json",
    "lib/travel/globe-math.ts",
  ]) {
    const result = plan(travelPath);
    assert.equal(result.status, 0, `${travelPath}\n${output(result)}`);
    for (const command of [
      "npm run travel:geography:check",
      "npm run test:backend",
      "npm run test:rendered",
      "npm run db:local:migrate:clean",
      "npm run validate:browser",
    ]) {
      assert.match(result.stdout, new RegExp(command.replaceAll(" ", "\\s+")), `${travelPath}: ${command}`);
    }
  }
});

test("Travel media mutations require behavior-level security coverage", () => {
  for (const travelPath of [
    "lib/server/travel/media.ts",
    "lib/server/travel/repository/photos.ts",
    "lib/server/travel/repository/uploads-media.ts",
    "lib/server/travel/repository/publication.ts",
  ]) {
    const uncovered = plan(travelPath);
    assert.equal(uncovered.status, 1, travelPath);
    assert.match(
      output(uncovered),
      /Travel upload, media, photo, or publication code changed without a Travel backend\/security regression test/,
      travelPath,
    );
  }

  const covered = plan(
    "lib/server/travel/media.ts",
    "tests/travel-security.test.mjs",
  );
  assert.equal(covered.status, 0, output(covered));
  assert.match(covered.stdout, /- travel/);
  assert.match(covered.stdout, /npm run test:backend/);
  assert.match(covered.stdout, /npm run validate:browser/);
});

test("Simulation server and test changes select privacy, rendered, bundle, and browser gates", () => {
  const uncovered = plan("lib/server/simulation/provider.ts");
  assert.equal(uncovered.status, 1);
  assert.match(
    output(uncovered),
    /Simulation API, session, Gateway, or privacy code changed without a Simulation backend\/security regression test/,
  );

  const covered = plan(
    "lib/server/simulation/provider.ts",
    "tests/simulation-backend.test.mjs",
  );
  assert.equal(covered.status, 0, output(covered));
  assert.match(covered.stdout, /- simulation/);
  for (const command of [
    "npm run test:backend",
    "npm run test:rendered",
    "npm run bundle:scan",
    "npm run validate:browser",
  ]) {
    assert.match(
      covered.stdout,
      new RegExp(command.replaceAll(" ", "\\s+")),
      command,
    );
  }
  assert.match(covered.stdout, /Gateway prompt\/response logging and caching are disabled/);

  const regressionOnly = plan("tests/simulation-backend.test.mjs");
  assert.equal(regressionOnly.status, 0, output(regressionOnly));
  assert.match(regressionOnly.stdout, /- simulation/);
  assert.match(regressionOnly.stdout, /npm run test:backend/);
});

test("closed room registry changes require parity coverage", () => {
  const uncovered = plan(
    "components/play/room-platform/room-object-contract.ts",
  );
  assert.equal(uncovered.status, 1);
  assert.match(output(uncovered), /registry-parity regression test/);

  const covered = plan(
    "components/play/room-platform/room-object-contract.ts",
    "tests/play-room-routes.test.mjs",
  );
  assert.equal(covered.status, 0, output(covered));
  assert.match(covered.stdout, /npm run test:rendered/);
  assert.match(covered.stdout, /npm run validate:browser/);
});

test("ordinary documentation changes remain documentation-only", () => {
  const result = plan("docs/testing.md");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /- documentation/);
  assert.match(result.stdout, /Checks:\n  - npm run docs:check\n/);
  assert.doesNotMatch(result.stdout, /npm run build|npm run test:backend/);
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

test("runner work paths derived from the authenticated account home are accepted", () => {
  assert.deepEqual(
    scanSensitiveContent(
      "scripts/runner/entrypoint.sh",
      'runner_work="${runner_home%/}/_work"\n--work "$runner_work"\n',
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

test("applied Drizzle snapshots are immutable with their SQL migration", () => {
  const result = plan("drizzle/meta/0007_snapshot.json");
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

test("release work selects ordinary validation without production mutation", () => {
  const result = plan("releases/next-release.json");
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /Checks:\n  - npm run validate\n/);
  assert.match(
    result.stdout,
    /Run validate:release separately only for a clean, pushed, explicitly approved production candidate/,
  );
  assert.match(result.stdout, /maintenance helper never deploys/);
  assert.doesNotMatch(result.stdout, /cloudflare:deploy|cloudflare:migrate/);
});

test("release gate implementation changes select release-code validation", () => {
  for (const gate of [
    "scripts/lib/release-config-contract.mjs",
    "scripts/lib/deployable-artifact-contract.mjs",
    "scripts/deployable-artifact-manifest.mjs",
    "scripts/check-codeql-sarif.mjs",
    "scripts/run-lighthouse-quality.mjs",
  ]) {
    const result = plan(gate);
    assert.equal(result.status, 0, `${gate}\n${output(result)}`);
    assert.match(result.stdout, /Checks:\n  - npm run validate\n/, gate);
    assert.match(result.stdout, /Run validate:release separately/, gate);
    assert.doesNotMatch(result.stdout, /cloudflare:deploy|cloudflare:migrate/, gate);
  }
});
