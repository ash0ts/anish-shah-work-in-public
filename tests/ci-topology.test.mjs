import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyCiChanges,
  pathsFromPullRequestFiles,
} from "../scripts/lib/ci-change-classifier.mjs";

const text = (relative) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("CI classifier selects bounded validation and browser lanes", () => {
  const docs = classifyCiChanges(["docs/testing.md"]);
  assert.equal(docs.lane, "docs");
  assert.equal(docs.requiresBuild, false);
  assert.deepEqual(docs.browserScopes, []);

  const copy = classifyCiChanges(["content/copy/pages/home.md"]);
  assert.equal(copy.lane, "copy");
  assert.equal(copy.requiresBuild, false);
  assert.deepEqual(copy.browserScopes, []);

  const connector = classifyCiChanges([
    "app/api/connectors/discogs/route.ts",
    "tests/content-discogs-connector.test.mjs",
  ]);
  assert.equal(connector.lane, "backend");
  assert.equal(connector.requiresBuild, false);
  assert.equal(connector.requiresCodeql, true);
  assert.deepEqual(connector.browserScopes, []);

  const ui = classifyCiChanges(["components/SiteHeader.tsx"]);
  assert.equal(ui.lane, "ui");
  assert.equal(ui.requiresBuild, true);
  assert.deepEqual(ui.browserScopes, ["room-public"]);

  const room = classifyCiChanges(["components/play/room-3d/Room.tsx"]);
  assert.equal(room.lane, "room");
  assert.deepEqual(room.browserScopes, ["room-public", "room-pr"]);

  const simulation = classifyCiChanges([
    "components/simulation/SimulationCampaign.tsx",
  ]);
  assert.equal(simulation.lane, "simulation");
  assert.deepEqual(simulation.browserScopes, ["simulation"]);

  const travel = classifyCiChanges(["lib/server/travel/publication.ts"]);
  assert.equal(travel.lane, "travel");
  assert.deepEqual(travel.browserScopes, ["travel"]);

  assert.equal(classifyCiChanges(["app/play/travel/page.tsx"]).lane, "travel");
  assert.equal(classifyCiChanges(["app/simulation/page.tsx"]).lane, "simulation");
  assert.equal(
    classifyCiChanges(["components/play/room-3d/Room.tsx"]).lane,
    "room",
  );
  assert.equal(
    classifyCiChanges([
      "app/play/travel/page.tsx",
      "app/api/connectors/steam/route.ts",
    ]).lane,
    "full",
  );
  assert.equal(
    classifyCiChanges([
      "app/play/travel/page.tsx",
      "components/SiteHeader.tsx",
    ]).lane,
    "full",
  );

  const full = classifyCiChanges(["package-lock.json"]);
  assert.equal(full.lane, "full");
  assert.equal(full.requiresBuild, true);
  assert.deepEqual(full.browserScopes, []);

  for (const plan of [docs, copy, connector, ui, room, simulation, travel, full]) {
    assert.ok(plan.browserScopes.length <= 2);
  }
  assert.throws(
    () => classifyCiChanges(["../private.env"]),
    /repository-relative/u,
  );

  assert.deepEqual(
    pathsFromPullRequestFiles([
      {
        filename: "docs/new-name.md",
        previous_filename: "docs/old-name.md",
        status: "renamed",
      },
    ]),
    ["docs/new-name.md", "docs/old-name.md"],
  );
  assert.throws(
    () => pathsFromPullRequestFiles([{ filename: "docs/new.md", status: "renamed" }]),
    /previous_filename/u,
  );
});

test("ordinary pull requests use one stable path-classified PR Gate", async () => {
  const [gate, validate, browser, gitleaks, codeql] = await Promise.all([
    text(".github/workflows/pr-gate.yml"),
    text(".github/workflows/ci.yml"),
    text(".github/workflows/browser-quality.yml"),
    text(".github/workflows/gitleaks.yml"),
    text(".github/workflows/codeql.yml"),
  ]);
  assert.match(gate, /^name: PR Gate$/mu);
  assert.match(gate, /name: Check out trusted base-branch tooling/u);
  assert.match(gate, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(gate, /--changes-file "\$\{RUNNER_TEMP\}\/pr-files\.json"/u);
  assert.match(gate, /Validate candidate docs with trusted base-branch tooling/u);
  assert.match(gate, /check-docs\.mjs --root/u);
  assert.doesNotMatch(gate, /^  docs:/mu);
  assert.match(gate, /node scripts\/ci\/classify-changes\.mjs/u);
  assert.match(gate, /^  pr_gate:\n    name: PR Gate$/mu);
  assert.match(gate, /name: Upload the one immutable PR build/u);
  assert.match(gate, /npm run deployable:attest:write/u);
  assert.match(gate, /name: targeted browser coverage/u);
  assert.match(gate, /node scripts\/ci\/run-browser-scopes\.mjs/u);
  assert.match(gate, /separate trusted copy-preview/u);
  assert.doesNotMatch(
    gate,
    /requires_build == 'true' \|\|\s+contains\(github\.event\.pull_request\.labels/u,
  );
  assert.ok(
    (gate.match(/needs\.classify\.outputs\.lane == 'backend'/gu) ?? []).length >= 3,
  );
  assert.doesNotMatch(validate, /pull_request:/u);
  assert.doesNotMatch(browser, /pull_request:/u);
  assert.match(gitleaks, /pull_request:/u);
  assert.match(codeql, /pull_request:\n    paths:/u);
  assert.doesNotMatch(codeql, /- "tests\/\*\*"/u);
  assert.match(codeql, /tests\/ci-topology\.test\.mjs/u);
  assert.match(codeql, /tests\/backend-security\.test\.mjs/u);
  assert.match(codeql, /tests\/content-discogs-oauth\.test\.mjs/u);
  assert.match(codeql, /if: env\.ANISH_RELEASE_RUNNER != '1'/u);
  assert.match(codeql, /Verify the CodeQL runtime/u);
  for (const workflow of [validate, gitleaks, codeql]) {
    assert.match(workflow, /push:\n    branches: \[main\]/u);
    assert.doesNotMatch(workflow, /push:\n    branches: \[[^\]]*release/u);
  }
  for (const workflow of [gate, validate, browser, gitleaks, codeql]) {
    assert.match(workflow, /cancel-in-progress: true/u);
  }
});

test("repository setup reuses the exact baked release-runner toolchain", async () => {
  const [action, dockerfile] = await Promise.all([
    text(".github/actions/setup-repository/action.yml"),
    text(".github/runner/Dockerfile"),
  ]);
  assert.match(dockerfile, /ANISH_RELEASE_RUNNER=1/u);
  assert.match(action, /if: env\.ANISH_RELEASE_RUNNER != '1'/u);
  assert.match(action, /if: env\.ANISH_RELEASE_RUNNER == '1'/u);
  assert.match(action, /test "\$\(node --version\)" = "\$expected_node"/u);
  assert.match(action, /test "\$\(npm --version\)" = "\$expected_npm"/u);
  assert.match(action, /if \[ "\$\(npm --version\)" != "\$npm_version" \]/u);
});

test("release browser evidence reuses the exact Validate artifact", async () => {
  const [validate, browser, soak] = await Promise.all([
    text(".github/workflows/ci.yml"),
    text(".github/workflows/browser-quality.yml"),
    text(".github/workflows/browser-stability.yml"),
  ]);
  assert.match(validate, /name: validated-dist-\$\{\{ env\.VALIDATE_SOURCE_SHA \}\}/u);
  assert.match(validate, /npm run deployable:attest:write/u);
  assert.match(browser, /validate_run_id:/u);
  assert.match(browser, /\.github\/workflows\/ci\.yml/u);
  assert.match(browser, /name: validated-dist-\$\{\{ env\.BROWSER_SOURCE_SHA \}\}/u);
  assert.match(browser, /npm run deployable:attest/u);
  assert.doesNotMatch(browser, /npm run build/u);
  assert.match(browser, /playwright install --with-deps chromium webkit/u);
  assert.match(browser, /Exercise Spotify Ranked Groove in WebKit/u);
  assert.match(browser, /playwright\.spotify-webkit\.config\.mjs/u);
  assert.match(browser, /Spotify rank navigation and consent remain keyboard-first/u);
  for (const workflow of [validate, browser, soak]) {
    assert.match(workflow, /fetch-depth: 0/u);
    assert.match(
      workflow,
      /test "\$EXPECTED_SHA" = "\$trusted_ref"/u,
    );
    assert.doesNotMatch(workflow, /git merge-base --is-ancestor/u);
  }
  assert.match(soak, /Verify the producing Validate workflow/u);
  assert.match(soak, /\.github\/workflows\/ci\.yml/u);
  assert.match(soak, /\.head_sha/u);
  assert.match(soak, /\.conclusion/u);
  assert.match(soak, /workflow_dispatch\|push/u);
  assert.match(soak, /worker: \[1, 2\]/u);
  assert.match(soak, /max-parallel: 2/u);
  assert.match(soak, /BROWSER_SOAK_LOOPS: "5"/u);
  assert.doesNotMatch(soak, /npm run build/u);
  assert.doesNotMatch(soak, /runs-on: ubuntu-latest/u);
});

test("code previews are opt-in and janitor work is weekly and dependency-free", async () => {
  const [deploy, cleanup, copyValidation, copyPreview] = await Promise.all([
    text(".github/workflows/preview-deploy.yml"),
    text(".github/workflows/preview-cleanup.yml"),
    text(".github/workflows/copy-only-validate.yml"),
    text(".github/workflows/copy-preview-deploy.yml"),
  ]);
  assert.match(deploy, /workflows: \[PR Gate\]/u);
  assert.match(deploy, /index\("preview"\) != null/u);
  assert.match(deploy, /preview_requested == 'true'/u);
  assert.match(deploy, /name: pr-build-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
  assert.match(cleanup, /cron: "41 6 \* \* 1"/u);
  assert.match(cleanup, /types: \[closed, unlabeled\]/u);
  assert.match(cleanup, /github\.event\.label\.name == 'preview'/u);
  assert.doesNotMatch(cleanup, /setup-repository/u);
  assert.match(cleanup, /node scripts\/preview-cleanup\.mjs janitor --apply/u);
  assert.match(copyValidation, /paths:\n\s+- "content\/copy\/\*\*"/u);
  assert.match(copyPreview, /npm run test:rendered/u);
  assert.match(copyPreview, /name: Capture affected routes/u);
  assert.match(copyPreview, /name: Upload copy screenshots/u);
});

test("disposable runner images pin and verify every downloaded runtime", async () => {
  const [dockerfile, build, run, entrypoint, hook] = await Promise.all([
    text(".github/runner/Dockerfile"),
    text("scripts/runner/build-image.sh"),
    text("scripts/runner/run-ephemeral.sh"),
    text("scripts/runner/entrypoint.sh"),
    text("scripts/runner/job-started-hook.sh"),
  ]);
  assert.match(build, /ubuntu@sha256:[a-f0-9]{64}/u);
  assert.match(build, /node_sha=[a-f0-9]{64}/u);
  assert.match(build, /runner_sha=[a-f0-9]{64}/u);
  assert.match(build, /mktemp -d/u);
  assert.match(build, /context\/Dockerfile/u);
  assert.match(build, /context\/entrypoint\.sh/u);
  assert.match(build, /context\/job-started-hook\.sh/u);
  assert.match(build, /arguments\+=\("\$context"\)/u);
  assert.doesNotMatch(build, /arguments\+=\("\$root"\)/u);
  assert.match(dockerfile, /COPY --chown=runner:runner entrypoint\.sh/u);
  assert.match(dockerfile, /COPY --chown=runner:runner job-started-hook\.sh/u);
  assert.doesNotMatch(dockerfile, /COPY .*scripts\/runner/u);
  assert.match(dockerfile, /NODE_VERSION=24\.18\.0/u);
  assert.match(dockerfile, /NPM_VERSION=11\.6\.2/u);
  assert.match(dockerfile, /PLAYWRIGHT_VERSION=1\.62\.1/u);
  assert.match(dockerfile, /playwright install --with-deps chromium webkit/u);
  assert.match(build, /install_browsers=1/u);
  assert.match(build, /install_browsers=0/u);
  assert.match(build, /INSTALL_BROWSERS=\$install_browsers/u);
  assert.match(dockerfile, /RUNNER_VERSION=2\.332\.0/u);
  assert.equal((dockerfile.match(/sha256sum --check --strict/gu) ?? []).length, 2);
  assert.match(entrypoint, /--ephemeral/u);
  assert.match(entrypoint, /--disableupdate/u);
  assert.match(entrypoint, /--no-default-labels/u);
  assert.match(entrypoint, /self-hosted,linux,\$\{architecture_label\},\$\{label\}/u);
  assert.match(entrypoint, /RUNNER_INSTANCE_ID/u);
  assert.match(entrypoint, /ACTIONS_RUNNER_HOOK_JOB_STARTED/u);
  assert.match(entrypoint, /NODE_EXTRA_CA_CERTS="\$combined_ca"/u);
  assert.match(entrypoint, /GIT_SSL_CAINFO="\$combined_ca"/u);
  assert.match(entrypoint, /SSL_CERT_FILE="\$combined_ca"/u);
  assert.match(entrypoint, /\/tmp\/anish-release-ca\.pem/u);
  assert.match(hook, /GITHUB_EVENT_NAME:-\}" = "workflow_dispatch"/u);
  assert.match(hook, /refs\/heads\/\(main\|release/u);
  assert.match(hook, /test "\$requested_sha" = "\$GITHUB_SHA"/u);
  assert.match(dockerfile, /--mount=type=secret,id=corporate_ca/u);
  assert.match(dockerfile, /trap 'rm -f \/tmp\/anish-build-ca\.pem/u);
  assert.doesNotMatch(dockerfile, /update-ca-certificates|owner-corporate-ca\.crt/u);
  assert.ok(
    (dockerfile.match(/Acquire::https::CaInfo/gu) ?? []).length >= 3,
  );
  assert.match(run, /target=\/run\/anish-corporate-ca\/root\.crt,readonly/u);
  assert.doesNotMatch(run, /docker\.sock|--volume|^\s+-v(?:\s|$)/mu);
  assert.doesNotMatch(`${dockerfile}\n${run}`, /sudo|--privileged/u);
  assert.match(run, /--cap-drop ALL/u);
  assert.match(run, /--security-opt no-new-privileges/u);
  assert.match(run, /--cpus 4/u);
  assert.match(run, /--memory 10g/u);
  assert.match(run, /--pids-limit 512/u);
  assert.match(run, /RUNNER_MAX_MINUTES:-75/u);
  assert.match(run, /\[\[ "\$instance_id" =~ \^instance-/u);
  assert.match(run, /\$\{label\}-\$\{instance_id\}-\$\{architecture\}/u);
  assert.match(run, /IFS= read -r token/u);
  assert.match(run, /Standard input must contain exactly one registration-token line/u);
  assert.match(run, /env -u RUNNER_REGISTRATION_TOKEN docker/u);
  assert.doesNotMatch(run, /token="\$\{RUNNER_REGISTRATION_TOKEN/u);
  assert.match(run, /max_minutes" -gt 120/u);
  assert.match(run, /sleep "\$\(\(max_minutes \* 60\)\)"/u);
  assert.match(run, /docker stop --time 15/u);
  assert.match(run, /status=124/u);
  assert.doesNotMatch(run, /--env RUNNER_REGISTRATION_TOKEN/u);
  assert.match(
    run,
    /printf '%s\\n' "\$token" \| env -u RUNNER_REGISTRATION_TOKEN docker/u,
  );
});

test("runner build sends Docker only the three allowlisted context files", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "anish-runner-context-test-"));
  try {
    const fakeDocker = path.join(temporary, "docker");
    const capture = path.join(temporary, "capture.json");
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env node
const { readdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const context = args.at(-1);
writeFileSync(process.env.RUNNER_CONTEXT_CAPTURE, JSON.stringify({
  args,
  context,
  files: readdirSync(context).sort(),
  dockerfile: readdirSync(context).includes("Dockerfile"),
  outsideRepository: !path.resolve(context).startsWith(path.resolve(process.cwd()) + path.sep),
}));
`,
      { mode: 0o755 },
    );
    await chmod(fakeDocker, 0o755);
    const result = spawnSync("bash", ["scripts/runner/build-image.sh", "arm64"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        OWNER_CA_FILE: "",
        PATH: `${temporary}:${process.env.PATH}`,
        RUNNER_CONTEXT_CAPTURE: capture,
        TMPDIR: temporary,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(await readFile(capture, "utf8"));
    assert.deepEqual(observed.files, [
      "Dockerfile",
      "entrypoint.sh",
      "job-started-hook.sh",
    ]);
    assert.equal(observed.dockerfile, true);
    assert.equal(observed.outsideRepository, true);
    assert.match(observed.context, /anish-release-runner-context\./u);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

test("runner launcher accepts exactly one stdin token and no exported token", () => {
  const environment = {
    ...process.env,
    RUNNER_INSTANCE_ID: "instance-0123456789ab",
    RUNNER_JIT_LABEL: "anish-release-0123456789ab",
  };
  const multiple = spawnSync(
    "bash",
    ["scripts/runner/run-ephemeral.sh", "arm64"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: environment,
      input: "one-token\nsecond-line",
    },
  );
  assert.equal(multiple.status, 64);
  assert.match(multiple.stderr, /exactly one registration-token line/u);

  const exported = spawnSync(
    "bash",
    ["scripts/runner/run-ephemeral.sh", "arm64"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...environment, RUNNER_REGISTRATION_TOKEN: "not-accepted" },
      input: "one-token\n",
    },
  );
  assert.equal(exported.status, 64);
  assert.match(exported.stderr, /must not be exported/u);
});
