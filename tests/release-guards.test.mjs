import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertReleaseMarker,
  assertProductionDeployment,
  assertRequiredValidationRuns,
  assertVerifiedActionsRun,
  exactMigrationNames,
  exactVersionIds,
  githubRepositoryFromRemoteUrl,
  parseRemoteReleaseMarker,
  publicationCheckpointForPlan,
  requireExactUploadedVersion,
  requiredSmokeTestsForPlayMode,
  ROOM_PLAY_SMOKE_TESTS,
  runGuardedMigration,
} from "../scripts/lib/release-contract.mjs";
import {
  assertPinnedProductionResources,
  assertPublicReleaseConfig,
  expectedPublicReleaseConfig,
} from "../scripts/lib/release-config-contract.mjs";
import {
  assertTriggerDeploymentReceipt,
  createTriggerDeploymentReceipt,
  expectedNonVersionedTriggerSettings,
} from "../scripts/lib/release-trigger-contract.mjs";
import {
  buildDeployableArtifactManifest,
  verifyDeployableArtifactManifest,
} from "../scripts/lib/deployable-artifact-contract.mjs";

function validReleaseConfigFixture() {
  const head = "a".repeat(40);
  const contentVersion = "b".repeat(16);
  const productionD1Id = [
    "b9dbe711", "1cb2", "4d9d", "b8a9", "e8c9817a8284",
  ].join("-");
  const productionKvId = ["ffa5a21ac0794aa0", "b6dfc0b5d1bb3c71"].join("");
  const productionAudience = [
    "d4e795ec79fe4cb854aad43bd5d22722",
    "75505c6054f218fde92f6b633ca5c735",
  ].join("");
  const environment = {
    PUBLIC_SITE_URL: "https://anish-shah-is.online",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_AUD: productionAudience,
    CLOUDFLARE_D1_DATABASE_ID: productionD1Id,
    CLOUDFLARE_D1_DATABASE_NAME: "anish-shah-work-in-public",
    CLOUDFLARE_PUBLICATION_CACHE_ID: productionKvId,
    PLAY_EXPERIENCE_MODE: "my-room-2001",
  };
  const expected = expectedPublicReleaseConfig(environment, {
    head,
    contentVersion,
  });
  return {
    environment,
    expected,
    config: {
      name: "anish-shah-work-in-public",
      topLevelName: "anish-shah-work-in-public",
      account_id: expected.accountId,
      workers_dev: false,
      preview_urls: false,
      routes: [{ pattern: "anish-shah-is.online", custom_domain: true }],
      d1_databases: [
        {
          binding: "DB",
          database_id: expected.databaseId,
          database_name: expected.databaseName,
          migrations_dir: "../../drizzle",
        },
      ],
      kv_namespaces: [
        { binding: "PUBLICATION_CACHE", id: expected.publicationCacheId },
      ],
      ratelimits: [
        ["OWNER_RATE_LIMITER", "88001001", 30],
        ["ARTWORK_RATE_LIMITER", "88001002", 120],
        ["PROMOTION_RATE_LIMITER", "88001003", 6],
        ["OAUTH_CALLBACK_RATE_LIMITER", "88001004", 20],
      ].map(([name, namespace_id, limit]) => ({
        name,
        namespace_id,
        simple: { limit, period: 60 },
      })),
      vars: {
        AUTH_MODE: "cloudflare_access",
        CF_ACCESS_AUD: expected.audiences,
        CF_ACCESS_TEAM_DOMAIN: expected.teamDomain,
        NODE_ENV: "production",
        OWNER_EMAILS: expected.ownerEmails,
        PRODUCTION_SITE_URL: expected.siteUrl,
        SITE_URL: expected.siteUrl,
        STEAM_DATA_STORAGE_COUNTRIES: "United States",
        RELEASE_SHA: head,
        CONTENT_VERSION: contentVersion,
        PUBLIC_CONTENT_MODE: "d1_kv_required",
        DEPLOYMENT_TIER: "production",
        PLAY_EXPERIENCE_MODE: expected.playExperienceMode,
      },
      observability: {
        enabled: true,
        head_sampling_rate: 1,
        logs: { enabled: true, invocation_logs: false },
      },
      triggers: { crons: ["17 * * * *"] },
    },
  };
}

test("production release resources must match the pinned deployment contract", () => {
  const { expected } = validReleaseConfigFixture();
  assert.doesNotThrow(() =>
    assertPinnedProductionResources({
      databaseId: expected.databaseId,
      publicationCacheId: expected.publicationCacheId,
      audiences: expected.audiences.split(","),
    }),
  );
  assert.throws(
    () =>
      assertPinnedProductionResources({
        databaseId: "00000000-0000-4000-8000-000000000000",
        publicationCacheId: expected.publicationCacheId,
        audiences: expected.audiences.split(","),
      }),
    /pinned deployment contract/,
  );
  assert.throws(
    () =>
      assertPinnedProductionResources({
        databaseId: expected.databaseId,
        publicationCacheId: expected.publicationCacheId,
        audiences: [expected.audiences, "second-access-audience"],
      }),
    /pinned deployment contract/,
  );
});

test("release parsers return exact migration and Worker version identifiers", () => {
  assert.deepEqual(
    exactMigrationNames("pending 0005_steady_publication_guard.sql; unrelated.sql"),
    ["0005_steady_publication_guard.sql"],
  );
  const version = "dc8dcd28-271b-4367-9840-6c244f84cb40";
  assert.deepEqual(exactVersionIds(`prefix ${version} suffix`), [version]);
  assert.throws(
    () => requireExactUploadedVersion(`prefix ${version.slice(0, 12)} suffix`, version),
    /not present/,
  );
});

test("release preflight rejects a configuration that weakens production boundaries", () => {
  const { config, environment, expected } = validReleaseConfigFixture();
  assert.doesNotThrow(() => assertPublicReleaseConfig(config, expected));
  assert.equal(expected.playExperienceMode, "my-room-2001");
  assert.throws(
    () =>
      expectedPublicReleaseConfig(
        { ...environment, PLAY_EXPERIENCE_MODE: "experimental" },
        { head: expected.head, contentVersion: expected.contentVersion },
      ),
    /must be explicitly set to classic or my-room-2001/,
  );
  assert.throws(
    () =>
      assertPublicReleaseConfig(
        { ...config, vars: { ...config.vars, NODE_ENV: "development" } },
        expected,
      ),
    /exact public-release boundary/,
  );
  assert.throws(
    () =>
      assertPublicReleaseConfig(
        { ...config, account_id: "f".repeat(32) },
        expected,
      ),
    /exact public-release boundary/,
  );
  assert.throws(
    () =>
      assertPublicReleaseConfig(
        { ...config, workers_dev: true },
        expected,
      ),
    /exact public-release boundary/,
  );
  assert.throws(
    () =>
      assertPublicReleaseConfig(
        { ...config, routes: [] },
        expected,
      ),
    /exact public-release boundary/,
  );
  assert.throws(
    () =>
      assertPublicReleaseConfig(
        { ...config, vars: { ...config.vars, AUTH_MODE: "sites" } },
        expected,
      ),
    /exact public-release boundary/,
  );
  assert.throws(
    () =>
      assertPublicReleaseConfig(
        { ...config, d1_databases: [] },
        expected,
      ),
    /exact public-release boundary/,
  );
});

test("production Play mode must be explicit and supported for every hosted release", () => {
  const { environment, expected } = validReleaseConfigFixture();
  const missingMode = { ...environment };
  delete missingMode.PLAY_EXPERIENCE_MODE;
  assert.throws(
    () => expectedPublicReleaseConfig(missingMode, {
      head: expected.head,
      contentVersion: expected.contentVersion,
    }),
    /PLAY_EXPERIENCE_MODE is required/,
  );
  assert.equal(
    expectedPublicReleaseConfig(
      { ...environment, PLAY_EXPERIENCE_MODE: "classic" },
      { head: expected.head, contentVersion: expected.contentVersion },
    ).playExperienceMode,
    "classic",
  );
  assert.throws(
    () => expectedPublicReleaseConfig(
      { ...environment, PLAY_EXPERIENCE_MODE: "experimental" },
      { head: expected.head, contentVersion: expected.contentVersion },
    ),
    /must be explicitly set to classic or my-room-2001/,
  );
});

test("non-versioned trigger reconciliation is bound to the exact cutover release", () => {
  const { config } = validReleaseConfigFixture();
  const head = "a".repeat(40);
  const configSha256 = "c".repeat(64);
  const appliedAt = "2026-08-03T19:00:00.000Z";
  assert.deepEqual(expectedNonVersionedTriggerSettings(config), {
    workerName: "anish-shah-work-in-public",
    canonicalOrigin: "https://anish-shah-is.online",
    routes: [
      { pattern: "anish-shah-is.online", customDomain: true },
    ],
    workersDev: false,
    previewUrls: false,
    crons: ["17 * * * *"],
  });

  const receipt = createTriggerDeploymentReceipt({
    head,
    configSha256,
    config,
    appliedAt,
  });
  assert.deepEqual(
    assertTriggerDeploymentReceipt(receipt, {
      head,
      configSha256,
      config,
      notBefore: "2026-08-03T18:59:59.000Z",
    }),
    receipt,
  );
  assert.throws(
    () =>
      assertTriggerDeploymentReceipt(receipt, {
        head: "d".repeat(40),
        configSha256,
        config,
      }),
    /missing, stale, or does not match/,
  );
  assert.throws(
    () =>
      assertTriggerDeploymentReceipt(receipt, {
        head,
        configSha256,
        config: { ...config, preview_urls: true },
      }),
    /exact domain-cutover contract/,
  );
  assert.throws(
    () =>
      assertTriggerDeploymentReceipt(receipt, {
        head,
        configSha256,
        config,
        notBefore: "2026-08-03T19:00:01.000Z",
      }),
    /predate this release plan/,
  );
});

test("deployable artifact manifest rejects one changed ignored build asset", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "anish-deployable-"));
  try {
    mkdirSync(path.join(directory, "dist/client"), { recursive: true });
    mkdirSync(path.join(directory, "dist/server"), { recursive: true });
    writeFileSync(path.join(directory, "dist/client/app.js"), "safe-client\n");
    writeFileSync(path.join(directory, "dist/server/worker.js"), "safe-worker\n");
    const manifest = await buildDeployableArtifactManifest(directory);
    assert.equal(manifest.fileCount, 2);
    await assert.doesNotReject(() =>
      verifyDeployableArtifactManifest(directory, manifest),
    );
    writeFileSync(path.join(directory, "dist/client/app.js"), "changed-client\n");
    await assert.rejects(
      () => verifyDeployableArtifactManifest(directory, manifest),
      /do not match the prepared deterministic manifest/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pending migration mismatch stops before mutation", async () => {
  let applied = false;
  await assert.rejects(
    () =>
      runGuardedMigration({
        planned: ["0005_expected.sql"],
        listPending: async () => ["0006_unreviewed.sql"],
        apply: async () => {
          applied = true;
        },
      }),
    /do not exactly match/,
  );
  assert.equal(applied, false);
});

test("matching migration is applied once and post-apply state is verified", async () => {
  let listCalls = 0;
  let applyCalls = 0;
  const result = await runGuardedMigration({
    planned: ["0005_expected.sql"],
    listPending: async () =>
      listCalls++ === 0 ? ["0005_expected.sql"] : [],
    apply: async () => {
      applyCalls += 1;
    },
  });
  assert.deepEqual(result, { applied: true });
  assert.equal(applyCalls, 1);
  assert.equal(listCalls, 2);
});

test("a migration remaining after apply fails the release", async () => {
  await assert.rejects(
    () =>
      runGuardedMigration({
        planned: ["0005_expected.sql"],
        listPending: async () => ["0005_expected.sql"],
        apply: async () => {},
      }),
    /remain after apply/,
  );
});

test("GitHub evidence must be successful and bind the exact SHA and URL", () => {
  const evidence = {
    headSha: "a".repeat(40),
    conclusion: "success",
    name: "Validate",
    url: "https://github.com/example/repo/actions/runs/123",
  };
  assert.doesNotThrow(() =>
    assertVerifiedActionsRun(evidence, {
      head: evidence.headSha,
      url: `${evidence.url}/`,
      name: "Validate",
    }),
  );
  assert.throws(
    () =>
      assertVerifiedActionsRun(
        { ...evidence, conclusion: "failure" },
        { head: evidence.headSha, url: evidence.url, name: "Validate" },
      ),
    /not the required successful validation/,
  );
  assert.throws(
    () =>
      assertVerifiedActionsRun(evidence, {
        head: evidence.headSha,
        url: evidence.url,
        name: "CodeQL",
      }),
    /required successful validation/,
  );
});

test("release evidence requires four distinct exact-commit quality runs", () => {
  const head = "a".repeat(40);
  const runs = [
    ["validate", "Validate", "101"],
    ["gitleaks", "Gitleaks", "102"],
    ["codeql", "CodeQL", "103"],
    ["browser", "Browser Quality", "104"],
  ].map(([kind, name, id]) => ({
    kind,
    name,
    headSha: head,
    conclusion: "success",
    url: `https://github.com/example/repo/actions/runs/${id}`,
    ...(kind === "browser"
      ? {
          event: "workflow_dispatch",
          workflowDatabaseId: 404,
          workflowPath: ".github/workflows/browser-quality.yml",
        }
      : {}),
  }));
  assert.doesNotThrow(() => assertRequiredValidationRuns(runs, head));
  assert.throws(
    () => assertRequiredValidationRuns(runs.slice(0, 3), head),
    /Validate, Gitleaks, CodeQL, and Browser Quality/,
  );
  assert.throws(
    () =>
      assertRequiredValidationRuns(
        runs.map((run, index) =>
          index === 3 ? { ...run, url: runs[0].url } : run,
        ),
        head,
      ),
    /distinct/,
  );
  assert.throws(
    () => assertRequiredValidationRuns(runs, head, "different/repository"),
    /configured upstream repository/,
  );
  assert.throws(
    () => assertRequiredValidationRuns(
      runs.map((run) =>
        run.kind === "browser" ? { ...run, event: "pull_request" } : run,
      ),
      head,
    ),
    /manual workflow_dispatch/,
  );
  assert.throws(
    () => assertRequiredValidationRuns(
      runs.map((run) =>
        run.kind === "browser"
          ? { ...run, workflowPath: ".github/workflows/ci.yml" }
          : run,
      ),
      head,
    ),
    /exact browser-quality workflow file/,
  );
});

test("My Room releases require direct-route smoke evidence", () => {
  const base = ["public_routes", "security_headers"];
  assert.deepEqual(requiredSmokeTestsForPlayMode(base, "classic"), base);
  assert.deepEqual(
    requiredSmokeTestsForPlayMode(base, "my-room-2001"),
    [...base, ...ROOM_PLAY_SMOKE_TESTS],
  );
  assert.throws(
    () => requiredSmokeTestsForPlayMode(base, "unknown"),
    /unsupported Play experience mode/,
  );
});

test("release evidence derives and binds the GitHub upstream repository", () => {
  assert.equal(
    githubRepositoryFromRemoteUrl(
      "https://github.com/ash0ts/anish-shah-work-in-public.git",
    ),
    "ash0ts/anish-shah-work-in-public",
  );
  assert.equal(
    githubRepositoryFromRemoteUrl(
      "git@github.com:ash0ts/anish-shah-work-in-public.git",
    ),
    "ash0ts/anish-shah-work-in-public",
  );
  assert.throws(
    () => githubRepositoryFromRemoteUrl("https://example.com/fork/repo.git"),
    /supported GitHub remote/,
  );
});

test("publication compatibility and zero-traffic bootstrap are explicit", () => {
  const releaseContentVersion = "a".repeat(16);
  const ready = publicationCheckpointForPlan({
    hash: "b".repeat(64),
    contentVersion: releaseContentVersion,
    kvPointerMatches: true,
    releaseContentVersion,
    bootstrapPlanned: false,
    previousVersion: "old-version",
  });
  assert.equal(ready.status, "compatible");

  assert.throws(
    () =>
      publicationCheckpointForPlan({
        hash: "none",
        contentVersion: "none",
        kvPointerMatches: false,
        releaseContentVersion,
        bootstrapPlanned: false,
        previousVersion: "old-version",
      }),
    /zero-traffic pre-deploy bootstrap/,
  );
  const bootstrap = publicationCheckpointForPlan({
    hash: "none",
    contentVersion: "none",
    kvPointerMatches: false,
    releaseContentVersion,
    bootstrapPlanned: true,
    previousVersion: "old-version",
  });
  assert.equal(bootstrap.status, "predeploy_bootstrap_required");
  assert.throws(
    () =>
      publicationCheckpointForPlan({
        hash: "none",
        contentVersion: "none",
        kvPointerMatches: false,
        releaseContentVersion,
        bootstrapPlanned: true,
        previousVersion: null,
      }),
    /requires an existing Worker version/,
  );
});

test("remote release marker binds staged SHA to the current publication", () => {
  const head = "a".repeat(40);
  const contentVersion = "b".repeat(16);
  const contentHash = "c".repeat(64);
  const checkedAt = "2026-08-03T12:00:00.000Z";
  const marker = parseRemoteReleaseMarker(
    JSON.stringify([
      {
        results: [
          {
            status: "ready",
            detailsJson: JSON.stringify({
              releaseSha: head,
              contentVersion,
              contentHash,
              verifiedAt: checkedAt,
            }),
            checkedAt,
            currentContentHash: contentHash,
            currentContentVersion: contentVersion,
          },
        ],
      },
    ]),
  );
  assert.doesNotThrow(() =>
    assertReleaseMarker(marker, {
      head,
      contentVersion,
      preparedAt: "2026-08-03T11:59:00.000Z",
    }),
  );
  assert.throws(
    () =>
      assertReleaseMarker(
        { ...marker, currentContentHash: "d".repeat(64) },
        {
          head,
          contentVersion,
          preparedAt: "2026-08-03T11:59:00.000Z",
        },
      ),
    /missing, stale, or does not match/,
  );
  assert.throws(
    () =>
      assertReleaseMarker(marker, {
        head,
        contentVersion,
        preparedAt: "2026-08-03T12:01:00.000Z",
      }),
    /missing, stale, or does not match/,
  );
});

test("final release evidence requires the exact version at 100 percent", () => {
  const version = "dc8dcd28-271b-4367-9840-6c244f84cb40";
  assert.deepEqual(
    assertProductionDeployment(
      JSON.stringify({
        id: "deployment_123456",
        versions: [{ version_id: version, percentage: 100 }],
      }),
      version,
    ),
    {
      deploymentId: "deployment_123456",
      versionId: version,
      percentage: 100,
    },
  );
  assert.throws(
    () =>
      assertProductionDeployment(
        JSON.stringify({
          versions: [
            { version_id: version, percentage: 99 },
            { version_id: "other-version", percentage: 1 },
          ],
        }),
        version,
      ),
    /100% production traffic/,
  );
});
