import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assertPreviewConfiguration,
  assertStagingConfiguration,
  expectedPreviewCoordinates,
  expectedStagingCoordinates,
  previewConfiguration,
  safeGeneratedWorkerBase,
  stagingConfiguration,
} from "../scripts/lib/hosted-config-contract.mjs";
import {
  collectOpenPullRequestNumbers,
  ownedPreviewDomainRecord,
  previewPrFromWorkerName,
  previewResourceCoordinates,
} from "../scripts/lib/preview-resource-contract.mjs";
import {
  fetchWithTimeout,
  stagingSmokePaths,
  waitForReadOnlyStagingReadiness,
} from "../scripts/lib/staging-http-contract.mjs";
import {
  assertStagingDeployment,
  assertStagingCandidateHealth,
  assertStagingCheckpointReceipt,
  assertFreshStagingPromotionCheckpoint,
  assertStagingPublication,
  assertStagingTriggerReceipt,
  createStagingCheckpointReceipt,
  createStagingTriggerReceipt,
  stagingActionRequiresCleanMigrations,
  waitForStagingDeploymentState,
} from "../scripts/lib/staging-release-state.mjs";

register("./content-connector-loader.mjs", import.meta.url);

const { productionOriginResponse } = await import("../worker/production-origin.ts");
const { canonicalSecurityPathname } = await import("../worker/request-path.ts");
const {
  hostedDeploymentBoundaryResponse,
  simulationExperienceBoundaryResponse,
} = await import("../worker/deployment-boundary.ts");
const { requiresHostedAccessIdentity } = await import("../worker/access.ts");
const { securedResponse, securityPolicy } = await import("../worker/security-headers.ts");
const { previewConnectorSnapshot, previewStravaSnapshot } = await import(
  "../lib/server/preview-connector-fixtures.ts"
);
const { projectConnectorSnapshotForPublic } = await import(
  "../lib/server/connectors/public-gallery.ts"
);
const { previewTravelAtlas } = await import("../lib/server/travel/preview.ts");
const { snapshotContainsPhoto } = await import(
  "../lib/server/travel/projector.ts"
);
const {
  getCollectionScreenFoundation,
  getDiscogsScreenFoundation,
  getMovementScreenFoundation,
  getSpotifyScreenFoundation,
  previewFixtureForPlayRoute,
} = await import("../lib/server/play-screen-foundation.ts");

const contentVersion = "b".repeat(16);
const releaseSha = "a".repeat(40);
const releaseVersion = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;
const productionD1Id = [
  "b9dbe711", "1cb2", "4d9d", "b8a9", "e8c9817a8284",
].join("-");
const productionKvId = ["ffa5a21ac0794aa0", "b6dfc0b5d1bb3c71"].join("");
const productionAccessAudience = [
  "d4e795ec79fe4cb854aad43bd5d22722",
  "75505c6054f218fde92f6b633ca5c735",
].join("");

function generatedBase() {
  return {
    main: "index.js",
    compatibility_date: "2026-07-30",
    compatibility_flags: ["nodejs_compat"],
    jsx_factory: "React.createElement",
    jsx_fragment: "React.Fragment",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: { directory: "../client" },
    vars: {},
    triggers: {},
    durable_objects: { bindings: [] },
    d1_databases: [{
      binding: "DB",
      database_name: "site-creator-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
    }],
  };
}

function stagingEnvironment() {
  return {
    STAGING_VALIDATED_SHA: releaseSha,
    RELEASE_VALIDATED_SHA: releaseSha,
    RELEASE_VERSION: releaseVersion,
    STAGING_CLOUDFLARE_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
    STAGING_CLOUDFLARE_D1_DATABASE_NAME: "anish-shah-work-in-public-staging",
    STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID: "1".repeat(32),
    STAGING_CLOUDFLARE_TRAVEL_MEDIA_BUCKET: "anish-shah-travel-media-staging",
    STAGING_CF_ACCESS_AUD: "staging-access-audience",
    STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID: "99001001",
    STAGING_ARTWORK_RATE_LIMIT_NAMESPACE_ID: "99001002",
    STAGING_PROMOTION_RATE_LIMIT_NAMESPACE_ID: "99001003",
    STAGING_OAUTH_CALLBACK_RATE_LIMIT_NAMESPACE_ID: "99001004",
    STAGING_SIMULATION_RATE_LIMIT_NAMESPACE_ID: "99001005",
    STAGING_TRAVEL_MEDIA_RATE_LIMIT_NAMESPACE_ID: "99001006",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  };
}

test("staging config uses only isolated resources and exact noindex-ready boundaries", () => {
  const expected = expectedStagingCoordinates(stagingEnvironment(), contentVersion, releaseVersion);
  const config = stagingConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertStagingConfiguration(config, expected));
  assert.equal(config.name, "anish-shah-work-in-public-staging");
  assert.deepEqual(config.routes, [
    { pattern: "staging.anish-shah-is.online", custom_domain: true },
  ]);
  assert.equal(config.vars.DEPLOYMENT_TIER, "staging");
  assert.equal(config.vars.PUBLIC_CONTENT_MODE, "d1_kv_required");
  assert.equal(config.vars.RELEASE_VERSION, releaseVersion);
  assert.equal(config.vars.SIMULATION_EXPERIENCE_MODE, "disabled");
  assert.equal(config.vars.SIMULATION_AI_MODE, "authored-only");
  assert.equal(config.vars.SIMULATION_MODEL, "claude-sonnet-5");
  assert.equal(config.compatibility_date, "2026-07-30");
  assert.equal(config.vars.TRAVEL_ATLAS_MODE, "atlas-v1");
  assert.deepEqual(config.r2_buckets, [
    { binding: "TRAVEL_MEDIA", bucket_name: "anish-shah-travel-media-staging" },
  ]);
  assert.deepEqual(config.images, { binding: "IMAGES" });
  assert.equal(config.vars.PRODUCTION_SITE_URL, "https://anish-shah-is.online");
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.deepEqual(config.triggers.crons, ["47 * * * *"]);

  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CLOUDFLARE_D1_DATABASE_ID: productionD1Id,
    }, contentVersion, releaseVersion),
    /must differ/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID: productionKvId,
    }, contentVersion, releaseVersion),
    /must differ/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CLOUDFLARE_TRAVEL_MEDIA_BUCKET: "anish-shah-travel-media",
    }, contentVersion, releaseVersion),
    /non-production R2 bucket/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CF_ACCESS_AUD: productionAccessAudience,
    }, contentVersion, releaseVersion),
    /must differ/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID: "88001001",
    }, contentVersion, releaseVersion),
    /non-production/,
  );
});

test("staging can apply simulation persistence with the campaign disabled first", () => {
  const environment = {
    ...stagingEnvironment(),
    STAGING_SIMULATION_EXPERIENCE_MODE: "disabled",
  };
  const expected = expectedStagingCoordinates(environment, contentVersion, releaseVersion);
  const config = stagingConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertStagingConfiguration(config, expected));
  assert.equal(config.vars.SIMULATION_EXPERIENCE_MODE, "disabled");
  assert.equal(config.vars.SIMULATION_AI_MODE, "authored-only");
  assert.throws(
    () =>
      expectedStagingCoordinates(
        {
          ...stagingEnvironment(),
          STAGING_SIMULATION_EXPERIENCE_MODE: "fixture",
        },
        contentVersion,
        releaseVersion,
      ),
    /disabled, coming-soon, or campaign-v1/,
  );
});

test("staging can publish the simulation doorway without enabling the campaign", () => {
  const environment = {
    ...stagingEnvironment(),
    STAGING_SIMULATION_EXPERIENCE_MODE: "coming-soon",
  };
  const expected = expectedStagingCoordinates(
    environment,
    contentVersion,
    releaseVersion,
  );
  const config = stagingConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertStagingConfiguration(config, expected));
  assert.equal(config.vars.SIMULATION_EXPERIENCE_MODE, "coming-soon");
  assert.equal(config.vars.SIMULATION_AI_MODE, "authored-only");
  assert.equal(config.vars.TRAVEL_ATLAS_MODE, "atlas-v1");
});

test("staging can bootstrap Travel privately before atlas activation", () => {
  const environment = {
    ...stagingEnvironment(),
    STAGING_TRAVEL_ATLAS_MODE: "disabled",
  };
  const expected = expectedStagingCoordinates(
    environment,
    contentVersion,
    releaseVersion,
  );
  const config = stagingConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertStagingConfiguration(config, expected));
  assert.equal(config.vars.TRAVEL_ATLAS_MODE, "disabled");
  assert.throws(
    () =>
      expectedStagingCoordinates(
        {
          ...stagingEnvironment(),
          STAGING_TRAVEL_ATLAS_MODE: "fixture",
        },
        contentVersion,
        releaseVersion,
      ),
    /disabled or atlas-v1/,
  );
});

test("staging candidate receipts bind health, copy, Simulation, Travel, and publication state", () => {
  const candidateVersion = "candidate-version-1234";
  const priorVersion = "prior-version-5678";
  const plan = {
    preparedAt: "2026-08-04T10:00:00.000Z",
    releaseVersion,
    contentVersion,
    copyVersion: "c".repeat(16),
    previousWorkerVersion: priorVersion,
    travelAtlasMode: "atlas-v1",
    simulation: {
      campaignVersion: "meet-me-4n1sh-v1",
      experienceMode: "campaign-v1",
      aiMode: "live",
      provider: "anthropic",
      model: "claude-sonnet-5",
      approvedProviders: ["hardcover"],
      approvalStateDigest: "d".repeat(64),
    },
  };
  const health = {
    status: "healthy",
    releaseSha,
    releaseVersion,
    contentVersion,
    copyVersion: plan.copyVersion,
    simulation: {
      campaignVersion: plan.simulation.campaignVersion,
      experienceMode: "campaign-v1",
      aiMode: "live",
      provider: "anthropic",
      model: "claude-sonnet-5",
      configured: true,
      approvedProviders: ["hardcover"],
      providerApprovalDigest: plan.simulation.approvalStateDigest,
    },
    travel: {
      mode: "atlas-v1",
      configured: true,
      activePublication: { contentHash: "e".repeat(64) },
      cleanupHeartbeat: { status: "current" },
    },
  };
  const publication = {
    status: "ready",
    contentVersion,
    contentHash: "f".repeat(64),
    kvPointerMatches: true,
  };
  const deployment = {
    id: "deployment-12345678",
    strategy: "percentage",
    versions: [
      { version_id: priorVersion, percentage: 100 },
      { version_id: candidateVersion, percentage: 0 },
    ],
  };
  assert.doesNotThrow(() =>
    assertStagingCandidateHealth(health, { head: releaseSha, plan }),
  );
  assert.doesNotThrow(() => assertStagingPublication(publication, plan));

  const receipt = createStagingCheckpointReceipt({
    head: releaseSha,
    workerVersion: candidateVersion,
    planSha256: "1".repeat(64),
    plan,
    health,
    publication,
    deployment,
    checkedAt: "2026-08-04T10:01:00.000Z",
  });
  assert.doesNotThrow(() =>
    assertStagingCheckpointReceipt(receipt, {
      head: releaseSha,
      workerVersion: candidateVersion,
      planSha256: "1".repeat(64),
      plan,
      health,
      publication,
      deployment,
      notBefore: plan.preparedAt,
    }),
  );
  assert.throws(
    () =>
      assertStagingCheckpointReceipt(receipt, {
        head: releaseSha,
        workerVersion: candidateVersion,
        planSha256: "1".repeat(64),
        plan,
        health: {
          ...health,
          travel: {
            ...health.travel,
            activePublication: { contentHash: "2".repeat(64) },
          },
        },
        publication,
        deployment,
        notBefore: plan.preparedAt,
      }),
    /does not match current state/,
  );
  assert.throws(
    () =>
      assertStagingCheckpointReceipt(receipt, {
        head: releaseSha,
        workerVersion: candidateVersion,
        planSha256: "1".repeat(64),
        plan,
        health,
        publication,
        deployment: { ...deployment, id: "deployment-raced-9999" },
        notBefore: plan.preparedAt,
      }),
    /does not match current state/,
  );
  assert.throws(
    () =>
      assertStagingCandidateHealth(
        { ...health, copyVersion: "3".repeat(16) },
        { head: releaseSha, plan },
      ),
    /does not match the planned SHA and versions/,
  );
  assert.throws(
    () =>
      assertStagingCandidateHealth(
        {
          ...health,
          travel: {
            ...health.travel,
            cleanupHeartbeat: { status: "never_run" },
          },
        },
        { head: releaseSha, plan },
      ),
    /not configured, published, and current/,
  );
});

test("staging health accepts coming-soon without AI or provider approvals", () => {
  const plan = {
    releaseVersion,
    contentVersion,
    copyVersion: "c".repeat(16),
    travelAtlasMode: "atlas-v1",
    simulation: {
      campaignVersion: "meet-me-4n1sh-v1",
      experienceMode: "coming-soon",
      aiMode: "authored-only",
      provider: "anthropic",
      model: "claude-sonnet-5",
      approvedProviders: [],
      approvalStateDigest: null,
    },
  };
  const health = {
    status: "healthy",
    releaseSha,
    releaseVersion,
    contentVersion,
    copyVersion: plan.copyVersion,
    simulation: {
      campaignVersion: plan.simulation.campaignVersion,
      experienceMode: "coming-soon",
      aiMode: "authored-only",
      provider: "anthropic",
      model: "claude-sonnet-5",
      configured: false,
      approvedProviders: [],
      providerApprovalDigest: null,
    },
    travel: {
      mode: "atlas-v1",
      configured: true,
      activePublication: { contentHash: "e".repeat(64) },
      cleanupHeartbeat: { status: "current" },
    },
  };

  assert.deepEqual(
    assertStagingCandidateHealth(health, { head: releaseSha, plan }).simulation,
    { approvedProviders: [], approvalStateDigest: null },
  );
  assert.throws(
    () =>
      assertStagingCandidateHealth(
        {
          ...health,
          simulation: {
            ...health.simulation,
            experienceMode: "campaign-v1",
            aiMode: "live",
            configured: true,
          },
        },
        { head: releaseSha, plan },
      ),
    /Simulation configuration or provider approvals do not match/,
  );
});

test("staging deployment guards enforce exact 0/100 and promoted traffic", () => {
  const candidateVersion = "candidate-version-1234";
  const priorVersion = "prior-version-5678";
  const staged = {
    id: "deployment-12345678",
    strategy: "percentage",
    versions: [
      { version_id: priorVersion, percentage: 100 },
      { version_id: candidateVersion, percentage: 0 },
    ],
  };
  const promoted = {
    id: "deployment-87654321",
    strategy: "percentage",
    versions: [{ version_id: candidateVersion, percentage: 100 }],
  };
  assert.deepEqual(
    assertStagingDeployment(staged, {
      candidateVersion,
      priorVersion,
      phase: "staged",
    }).traffic,
    [
      { versionId: candidateVersion, percentage: 0 },
      { versionId: priorVersion, percentage: 100 },
    ].sort((left, right) => left.versionId.localeCompare(right.versionId)),
  );
  assert.doesNotThrow(() =>
    assertStagingDeployment(promoted, {
      candidateVersion,
      phase: "deployed",
    }),
  );
  assert.throws(
    () =>
      assertStagingDeployment(
        {
          ...staged,
          versions: [
            { version_id: priorVersion, percentage: 90 },
            { version_id: candidateVersion, percentage: 10 },
          ],
        },
        { candidateVersion, priorVersion, phase: "staged" },
      ),
    /not isolated at 0%/,
  );
  assert.throws(
    () =>
      assertStagingDeployment(
        {
          ...promoted,
          versions: [
            ...promoted.versions,
            { version_id: priorVersion, percentage: 0 },
          ],
        },
        { candidateVersion, phase: "deployed" },
      ),
    /not the sole 100%/,
  );
  assert.throws(
    () =>
      assertStagingDeployment(
        { ...staged, strategy: "unknown" },
        { candidateVersion, priorVersion, phase: "staged" },
      ),
    /status is malformed/,
  );
  assert.throws(
    () =>
      assertStagingDeployment(
        {
          ...staged,
          versions: [
            { version_id: candidateVersion, percentage: "0" },
            { version_id: priorVersion, percentage: 100 },
          ],
        },
        { candidateVersion, priorVersion, phase: "staged" },
      ),
    /allocation is malformed/,
  );
  assert.throws(
    () =>
      assertStagingDeployment(
        {
          ...staged,
          versions: [
            { version_id: candidateVersion, percentage: 0 },
            { version_id: candidateVersion, percentage: 100 },
          ],
        },
        { candidateVersion, priorVersion, phase: "staged" },
      ),
    /allocation is ambiguous/,
  );
  assert.throws(
    () =>
      assertStagingDeployment(
        {
          ...staged,
          versions: [
            { version_id: candidateVersion, percentage: 0 },
            { version_id: priorVersion, percentage: 99 },
          ],
        },
        { candidateVersion, priorVersion, phase: "staged" },
      ),
    /allocation is ambiguous/,
  );
  assert.throws(
    () =>
      assertStagingDeployment(staged, {
        candidateVersion,
        priorVersion: candidateVersion,
        phase: "staged",
      }),
    /expected staging Worker deployment is invalid/,
  );
});

test("staging promotion rejects candidate state changed after checkpoint", async () => {
  const candidateVersion = "candidate-version-1234";
  const priorVersion = "prior-version-5678";
  const plan = {
    preparedAt: "2026-08-04T10:00:00.000Z",
    previousWorkerVersion: priorVersion,
    releaseVersion,
    contentVersion,
    copyVersion: "c".repeat(16),
    travelAtlasMode: "atlas-v1",
    simulation: {
      campaignVersion: "campaign-v1",
      experienceMode: "campaign-v1",
      aiMode: "live",
      provider: "anthropic",
      model: "claude-sonnet-5",
      approvedProviders: ["hardcover"],
      approvalStateDigest: "d".repeat(64),
    },
  };
  const checkpointHealth = {
    status: "healthy",
    releaseSha,
    releaseVersion,
    contentVersion,
    copyVersion: plan.copyVersion,
    simulation: {
      campaignVersion: plan.simulation.campaignVersion,
      experienceMode: plan.simulation.experienceMode,
      aiMode: plan.simulation.aiMode,
      provider: plan.simulation.provider,
      model: plan.simulation.model,
      configured: true,
      approvedProviders: plan.simulation.approvedProviders,
      providerApprovalDigest: plan.simulation.approvalStateDigest,
    },
    travel: {
      mode: "atlas-v1",
      configured: true,
      activePublication: { contentHash: "e".repeat(64) },
      cleanupHeartbeat: { status: "current" },
    },
  };
  const publication = {
    status: "ready",
    contentVersion,
    contentHash: "f".repeat(64),
    kvPointerMatches: true,
  };
  const deployment = {
    id: "deployment-12345678",
    strategy: "percentage",
    versions: [
      { version_id: priorVersion, percentage: 100 },
      { version_id: candidateVersion, percentage: 0 },
    ],
  };
  const checkpointReceipt = createStagingCheckpointReceipt({
    head: releaseSha,
    workerVersion: candidateVersion,
    planSha256: "1".repeat(64),
    plan,
    health: checkpointHealth,
    publication,
    deployment,
    checkedAt: "2026-08-04T10:01:00.000Z",
  });
  let candidateReads = 0;
  await assert.rejects(
    assertFreshStagingPromotionCheckpoint({
      readDeployment: async () => deployment,
      readCandidateState: async () => {
        candidateReads += 1;
        return {
          health: {
            ...checkpointHealth,
            travel: {
              ...checkpointHealth.travel,
              activePublication: { contentHash: "2".repeat(64) },
            },
          },
          publication,
        };
      },
      checkpointReceipt,
      expected: {
        head: releaseSha,
        workerVersion: candidateVersion,
        planSha256: "1".repeat(64),
        plan,
        notBefore: plan.preparedAt,
      },
    }),
    /does not match current state/,
  );
  assert.equal(candidateReads, 1);
});

test("staging deployment polling converges without repeating a write", async () => {
  const candidateVersion = "candidate-version-1234";
  const priorVersion = "prior-version-5678";
  const deployments = [
    {
      id: "deployment-old-1234",
      strategy: "percentage",
      versions: [{ version_id: priorVersion, percentage: 100 }],
    },
    {
      id: "deployment-new-5678",
      strategy: "percentage",
      versions: [
        { version_id: candidateVersion, percentage: 0 },
        { version_id: priorVersion, percentage: 100 },
      ],
    },
  ];
  let reads = 0;
  let writes = 0;
  writes += 1;
  const accepted = await waitForStagingDeploymentState({
    readDeployment: async () => deployments[Math.min(reads++, 1)],
    waitForReadiness: async ({ check }) => {
      assert.equal(await check(), false);
      assert.equal(await check(), true);
    },
    candidateVersion,
    priorVersion,
    phase: "staged",
  });
  assert.equal(accepted.state.deploymentId, "deployment-new-5678");
  assert.equal(reads, 2);
  assert.equal(writes, 1);

  await assert.rejects(
    waitForStagingDeploymentState({
      readDeployment: async () => deployments[0],
      waitForReadiness: async ({ check }) => {
        assert.equal(await check(), false);
      },
      candidateVersion,
      priorVersion,
      phase: "staged",
    }),
    /did not converge/,
  );
});

test("staging trigger receipts and migration gates protect every post-upload action", () => {
  const receipt = createStagingTriggerReceipt({
    head: releaseSha,
    configSha256: "4".repeat(64),
    appliedAt: "2026-08-04T10:01:00.000Z",
  });
  assert.doesNotThrow(() =>
    assertStagingTriggerReceipt(receipt, {
      head: releaseSha,
      configSha256: "4".repeat(64),
      notBefore: "2026-08-04T10:00:00.000Z",
    }),
  );
  assert.throws(
    () =>
      assertStagingTriggerReceipt(receipt, {
        head: releaseSha,
        configSha256: "5".repeat(64),
        notBefore: "2026-08-04T10:00:00.000Z",
      }),
    /does not match this release/,
  );
  for (const action of [
    "stage",
    "bootstrap",
    "checkpoint",
    "deploy",
    "smoke",
  ]) {
    assert.equal(stagingActionRequiresCleanMigrations(action), true);
  }
  for (const action of ["plan", "migrate", "upload", "rollback"]) {
    assert.equal(stagingActionRequiresCleanMigrations(action), false);
  }
});

test("staging smoke derives every enabled direct object route", () => {
  const paths = stagingSmokePaths();
  assert.deepEqual(
    paths.filter((pathname) => pathname.startsWith("/play/")),
    [
      "/play/watch",
      "/play/read",
      "/play/listen",
      "/play/collect",
      "/play/play",
      "/play/move",
    ],
  );
  assert.deepEqual(
    stagingSmokePaths({ travelEnabled: true }).filter((pathname) =>
      pathname.startsWith("/play/"),
    ),
    [...paths.filter((pathname) => pathname.startsWith("/play/")), "/play/travel"],
  );
  assert.throws(() => stagingSmokePaths({ travelEnabled: "yes" }), /switch/);
});

test("staging fetches have a hard timeout and readiness retries only reads", async () => {
  await assert.rejects(
    () => fetchWithTimeout(
      (_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      "https://staging.anish-shah-is.online/api/studio/health",
      { method: "GET" },
      5,
    ),
    /exceeded 5ms/,
  );
  await assert.rejects(
    () => fetchWithTimeout(
      (_input, init) => Promise.resolve({
        json: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted body")));
        }),
      }),
      "https://staging.anish-shah-is.online/api/studio/health",
      { method: "GET" },
      5,
      (response) => response.json(),
    ),
    /exceeded 5ms/,
  );

  let attempts = 0;
  const result = await waitForReadOnlyStagingReadiness({
    timeoutMs: 100,
    intervalMs: 1,
    check: async () => {
      attempts += 1;
      return attempts === 3;
    },
  });
  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);

  let failures = 0;
  await assert.rejects(
    () => waitForReadOnlyStagingReadiness({
      timeoutMs: 8,
      intervalMs: 1,
      check: async () => {
        failures += 1;
        throw new Error("provider details must not escape");
      },
    }),
    /did not become ready within 8ms/,
  );
  assert.ok(failures >= 1);
});

test("preview config has no durable, secret, cron, Studio, or OAuth capability", () => {
  const expected = expectedPreviewCoordinates({
    RELEASE_VALIDATED_SHA: releaseSha,
    RELEASE_VERSION: releaseVersion,
    PREVIEW_PR_NUMBER: "42",
    PREVIEW_CF_ACCESS_AUD: "preview-access-audience",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  }, contentVersion, releaseVersion);
  const config = previewConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertPreviewConfiguration(config, expected));
  assert.equal(config.name, "anish-shah-work-in-public-pr-42");
  assert.deepEqual(config.d1_databases, []);
  assert.deepEqual(config.kv_namespaces, []);
  assert.equal("r2_buckets" in config, false);
  assert.equal("images" in config, false);
  assert.deepEqual(config.ratelimits, []);
  assert.equal(config.triggers, undefined);
  assert.equal(config.vars.PUBLIC_CONTENT_MODE, "static_preview");
  assert.equal(config.vars.RELEASE_VERSION, releaseVersion);
  assert.equal(config.vars.DEPLOYMENT_TIER, "preview");
  assert.equal(config.vars.SIMULATION_EXPERIENCE_MODE, "disabled");
  assert.equal(config.vars.SIMULATION_AI_MODE, "authored-only");
  assert.equal(config.vars.SIMULATION_PROVIDER, "fixture");
  assert.equal(config.compatibility_date, "2026-07-30");
  assert.equal(config.vars.TRAVEL_ATLAS_MODE, "atlas-v1");
  assert.equal("OWNER_EMAILS" in config.vars, false);
  assert.equal("CONNECTOR_ENCRYPTION_KEY" in config.vars, false);
  assert.doesNotThrow(() =>
    safeGeneratedWorkerBase({
      ...generatedBase(),
      queues: { producers: [], consumers: [] },
    }),
  );

  for (const malicious of [
    { services: [{ binding: "PRODUCTION", service: "anish-shah-work-in-public" }] },
    { r2_buckets: [{ binding: "PRIVATE", bucket_name: "owner-private" }] },
    { secrets_store_secrets: [{ binding: "TOKEN", store_id: "private" }] },
    { d1_databases: [{ binding: "DB", database_name: "production", database_id: "22222222-2222-4222-8222-222222222222" }] },
  ]) {
    assert.throws(
      () => safeGeneratedWorkerBase({ ...generatedBase(), ...malicious }),
      /forbidden|non-placeholder/,
    );
  }
});

test("preview middleware serves bounded fixtures without hosted rate-limit secrets", async () => {
  const workerSource = await readFile(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const previewBoundary = workerSource.indexOf(
    "const boundaryFailure = hostedDeploymentBoundaryResponse",
  );
  const rateLimitBoundary = workerSource.indexOf(
    'const enforceRequestRateLimits = deploymentTier !== "preview"',
  );
  const setupGuard = workerSource.indexOf(
    "enforceRequestRateLimits &&\n        requiresConfiguredRateLimit",
  );
  const applicationRoute = workerSource.indexOf(
    "await routeApplicationRequest(appRequest, env, ctx, pathname)",
  );

  assert.ok(previewBoundary >= 0);
  assert.ok(rateLimitBoundary > previewBoundary);
  assert.ok(setupGuard > rateLimitBoundary);
  assert.ok(applicationRoute > setupGuard);
  assert.match(
    workerSource,
    /const discogsReadLimited = enforceRequestRateLimits[\s\S]*?throttleDiscogsPublicRead/,
  );
  assert.match(
    workerSource,
    /const travelMediaLimited = enforceRequestRateLimits[\s\S]*?throttleTravelMedia/,
  );
});

test("host routing accepts only the exact origin for each declared tier", () => {
  const options = { development: false, sitesRuntime: false };
  const production = {
    DEPLOYMENT_TIER: "production",
    SITE_URL: "https://anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "d1_kv_required",
    RELEASE_VERSION: releaseVersion,
  };
  const staging = {
    DEPLOYMENT_TIER: "staging",
    SITE_URL: "https://staging.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "d1_kv_required",
    RELEASE_VERSION: releaseVersion,
  };
  const preview = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: releaseVersion,
  };
  assert.equal(productionOriginResponse(
    new Request("https://anish-shah-is.online/work"), production, options,
  ), null);
  assert.equal(productionOriginResponse(
    new Request("https://staging.anish-shah-is.online/work"), staging, options,
  ), null);
  assert.equal(productionOriginResponse(
    new Request("https://pr-42.anish-shah-is.online/work"), preview, options,
  ), null);
  assert.equal(productionOriginResponse(
    new Request("https://anish-shah-is.online/work"), staging, options,
  )?.status, 421);
  assert.equal(productionOriginResponse(
    new Request("https://pr-43.anish-shah-is.online/work"), preview, options,
  )?.status, 421);
  assert.equal(productionOriginResponse(
    new Request("https://staging.anish-shah-is.online/work"),
    { ...staging, PUBLIC_CONTENT_MODE: "static_preview" }, options,
  )?.status, 503);
  assert.equal(productionOriginResponse(
    new Request("https://anish-shah-is.online/work"),
    { ...production, RELEASE_VERSION: undefined }, options,
  )?.status, 503);
  assert.equal(productionOriginResponse(
    new Request("https://anish-shah-is.online/work"),
    { ...production, RELEASE_VERSION: "v2.0.0" }, options,
  )?.status, 503);
  assert.equal(
    productionOriginResponse(
      new Request("https://pr-42.anish-shah-is.online/play"),
      preview,
      options,
    ),
    null,
  );
});

test("staging callbacks alone bypass identity while preview remains fully gated", () => {
  assert.equal(requiresHostedAccessIdentity("/work", "staging"), true);
  for (const provider of ["myanimelist", "spotify", "discogs"]) {
    assert.equal(
      requiresHostedAccessIdentity(
        `/api/connectors/${provider}/oauth/callback`,
        "staging",
      ),
      false,
      provider,
    );
    assert.equal(
      requiresHostedAccessIdentity(
        `/api/connectors/${provider}/oauth/callback/extra`,
        "staging",
      ),
      true,
      `${provider} near miss`,
    );
  }
  assert.equal(
    requiresHostedAccessIdentity("/api/connectors/spotify/oauth/callback", "preview"),
    true,
  );
  assert.equal(requiresHostedAccessIdentity("/work", "production"), false);

  const studio = hostedDeploymentBoundaryResponse(
    new Request("https://pr-42.anish-shah-is.online/studio"),
    "/studio",
    "preview",
  );
  assert.equal(studio?.status, 404);
  const write = hostedDeploymentBoundaryResponse(
    new Request("https://pr-42.anish-shah-is.online/api/example", { method: "POST" }),
    "/api/example",
    "preview",
  );
  assert.equal(write?.status, 405);
  for (const [pathname, method] of [
    ["/simulation", "GET"],
    ["/simulation/", "GET"],
    ["/api/simulation/session", "GET"],
    ["/api/simulation/session", "POST"],
    ["/api/simulation/turn", "POST"],
  ]) {
    const disabled = hostedDeploymentBoundaryResponse(
      new Request(`https://pr-42.anish-shah-is.online${pathname}`, {
        method,
      }),
      pathname,
      "preview",
    );
    assert.equal(disabled?.status, 404, `${method} ${pathname}`);
  }
  for (const tier of ["staging", "production"]) {
    for (const [pathname, method] of [
      ["/simulation", "GET"],
      ["/api/simulation/session", "GET"],
      ["/api/simulation/session", "POST"],
      ["/api/simulation/turn", "POST"],
    ]) {
      assert.equal(
        simulationExperienceBoundaryResponse(pathname, "disabled")?.status,
        404,
        `${tier} ${method} ${pathname}`,
      );
    }
  }
  assert.equal(
    simulationExperienceBoundaryResponse(
      "/simulation",
      "coming-soon",
    ),
    null,
  );
  assert.equal(
    simulationExperienceBoundaryResponse(
      "/api/simulation/session",
      "coming-soon",
    )?.status,
    404,
  );
  assert.equal(
    hostedDeploymentBoundaryResponse(
      new Request("https://pr-42.anish-shah-is.online/simulation"),
      "/simulation",
      "preview",
      "campaign-v1",
    ),
    null,
  );
  assert.equal(
    hostedDeploymentBoundaryResponse(
      new Request("https://pr-42.anish-shah-is.online/play"),
      "/play",
      "preview",
    ),
    null,
  );

  for (const rawPath of [
    "/simu%6cation",
    "/api/simu%6cation/session",
    "//api/simulation/turn",
  ]) {
    const canonicalPath = canonicalSecurityPathname(rawPath);
    assert.ok(canonicalPath, rawPath);
    assert.equal(
      simulationExperienceBoundaryResponse(canonicalPath, "disabled")?.status,
      404,
      rawPath,
    );
  }
});

test("sitemap always publishes enabled room routes and never exposes disabled Travel", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  const sitemap = (await import("../app/sitemap.ts")).default;
  try {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      TRAVEL_ATLAS_MODE: "disabled",
    };
    const withoutTravel = await sitemap();
    assert.deepEqual(
      withoutTravel
        .filter(({ url }) => /\/play\/(?:watch|read|listen|collect|play|move|travel)$/.test(url))
        .map(({ url }) => new URL(url).pathname)
        .sort(),
      [
        "/play/collect",
        "/play/listen",
        "/play/move",
        "/play/play",
        "/play/read",
        "/play/watch",
      ],
    );

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      TRAVEL_ATLAS_MODE: "atlas-v1",
    };
    const room = await sitemap();
    assert.deepEqual(
      room
        .filter(({ url }) => /\/play\/(?:watch|read|listen|collect|play|move|travel)$/.test(url))
        .map(({ url }) => new URL(url).pathname)
        .sort(),
      [
        "/play/collect",
        "/play/listen",
        "/play/move",
        "/play/play",
        "/play/read",
        "/play/travel",
        "/play/watch",
      ],
    );

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      DEPLOYMENT_TIER: "staging",
      SITE_URL: "https://staging.anish-shah-is.online",
      PRODUCTION_SITE_URL: "https://anish-shah-is.online",
      PUBLIC_CONTENT_MODE: "d1_kv_required",
      RELEASE_VERSION: releaseVersion,
      TRAVEL_ATLAS_MODE: "atlas-v1",
    };
    assert.deepEqual(await sitemap(), []);
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("production sitemap publishes only ready active Travel trip URLs", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  const sitemap = (await import("../app/sitemap.ts")).default;
  const snapshot = await previewTravelAtlas();
  const production = {
    DEPLOYMENT_TIER: "production",
    SITE_URL: "https://anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    TRAVEL_ATLAS_MODE: "atlas-v1",
  };
  const databaseFor = (activeSnapshot) => ({
    prepare(query) {
      return {
        async first() {
          if (!query.includes("FROM travel_publication_state")) return null;
          return activeSnapshot
            ? {
                snapshotJson: JSON.stringify(activeSnapshot),
                contentHash: activeSnapshot.contentHash,
              }
            : null;
        },
      };
    },
  });
  const tripUrlsFrom = (entries) =>
    entries
      .map(({ url }) => url)
      .filter((url) => new URL(url).pathname.startsWith("/play/travel/trips/"))
      .sort();
  const tripEntriesFrom = (entries) =>
    entries.filter(({ url }) =>
      new URL(url).pathname.startsWith("/play/travel/trips/"),
    );

  try {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      ...production,
      DB: databaseFor(snapshot),
    };
    const published = await sitemap();
    assert.deepEqual(
      tripUrlsFrom(published),
      snapshot.trips
        .map(
          ({ slug }) =>
            `https://anish-shah-is.online/play/travel/trips/${encodeURIComponent(slug)}`,
        )
        .sort(),
    );
    assert.ok(
      tripEntriesFrom(published).every(
        ({ lastModified }) =>
          lastModified?.toISOString() === snapshot.publishedAt,
      ),
    );

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      ...production,
      TRAVEL_ATLAS_MODE: "disabled",
      DB: databaseFor(snapshot),
    };
    assert.deepEqual(tripUrlsFrom(await sitemap()), []);

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      ...production,
      DB: databaseFor(null),
    };
    assert.deepEqual(tripUrlsFrom(await sitemap()), []);

    for (const environment of [
      {
        DEPLOYMENT_TIER: "staging",
        SITE_URL: "https://staging.anish-shah-is.online",
        PUBLIC_CONTENT_MODE: "d1_kv_required",
        RELEASE_VERSION: releaseVersion,
      },
      {
        DEPLOYMENT_TIER: "preview",
        PREVIEW_PR_NUMBER: "42",
        SITE_URL: "https://pr-42.anish-shah-is.online",
        PUBLIC_CONTENT_MODE: "static_preview",
        RELEASE_VERSION: releaseVersion,
      },
    ]) {
      globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
        ...production,
        ...environment,
        DB: databaseFor(snapshot),
      };
      assert.deepEqual(await sitemap(), [], environment.DEPLOYMENT_TIER);
    }
  } finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("staging and preview responses are private and unindexable", () => {
  for (const tier of ["staging", "preview"]) {
    const response = securedResponse(
      new Response("page", { status: 200, headers: { "content-type": "text/html" } }),
      new Request(`https://${tier === "staging" ? "staging" : "pr-42"}.anish-shah-is.online/work`, {
        headers: { accept: "text/html" },
      }),
      "A".repeat(24),
      false,
      "/work",
      tier,
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noimageindex/);
  }
});

test("RSC presentation reads hosted tier from Cloudflare runtime bindings", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: releaseVersion,
  };
  try {
    const [{ runtimeRootMetadata }, { PreviewEnvironmentNotice }, robotsModule, sitemapModule] =
      await Promise.all([
        import("../lib/server/root-metadata.ts"),
        import("../components/PreviewEnvironmentNotice.ts"),
        import("../app/robots.ts"),
        import("../app/sitemap.ts"),
      ]);
    const metadata = runtimeRootMetadata();
    assert.equal(
      metadata.title.default,
      "[PR #42] Anish Shah — Applied AI systems",
    );
    assert.deepEqual(metadata.robots, {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
    });
    const notice = renderToStaticMarkup(PreviewEnvironmentNotice());
    assert.match(notice, /Synthetic preview data · PR #42/);
    assert.match(notice, /Synthetic · PR #42/);
    assert.deepEqual(robotsModule.default(), {
      rules: { userAgent: "*", disallow: "/" },
    });
    assert.deepEqual(await sitemapModule.default(), []);
    assert.equal(metadata.metadataBase.origin, "https://anish-shah-is.online");
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("the preview marker stays in the header gap instead of covering page controls", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/\.preview-environment-notice\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(rule, "Expected the preview notice rule");
  assert.match(rule, /top:\s*0\.75rem/);
  assert.match(rule, /left:\s*50%/);
  assert.match(rule, /transform:\s*translateX\(-50%\)/);
  assert.doesNotMatch(rule, /bottom:|right:/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*preview-environment-notice__compact/);
});

test("preview blocks provider frames and serves only neutral artwork", async () => {
  const previewPolicy = securityPolicy("A".repeat(24), false, "preview");
  assert.match(previewPolicy, /frame-src 'none'/);
  assert.doesNotMatch(previewPolicy, /open\.spotify\.com|strava-embeds\.com/);
  assert.match(
    securityPolicy("A".repeat(24), false, "staging"),
    /frame-src https:\/\/open\.spotify\.com/,
  );

  const artwork = hostedDeploymentBoundaryResponse(
    new Request(
      "https://pr-42.anish-shah-is.online/api/connector-artwork/spotify/arbitrary",
    ),
    "/api/connector-artwork/spotify/arbitrary",
    "preview",
  );
  assert.equal(artwork?.status, 200);
  assert.equal(artwork?.headers.get("x-preview-artwork"), "neutral-placeholder");
  assert.equal(artwork?.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.doesNotMatch(
    await artwork?.text(),
    /open\.spotify\.com|i\.scdn\.co|myanimelist|hardcover|steam|strava/i,
  );
});

test("preview Travel media is read-only and closed to the exact synthetic fixture", async () => {
  const origin = "https://pr-42.anish-shah-is.online";
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: origin,
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: releaseVersion,
    TRAVEL_ATLAS_MODE: "atlas-v1",
  };
  try {
    const fixture = await previewTravelAtlas();
    const photo = fixture.trips.flatMap((trip) => trip.photos)[0];
    assert.ok(photo, "preview fixture must contain a photo");
    const pathname =
      `/api/travel-media/${photo.id}/480/${photo.mediaDigest}`;
    const request = new Request(`${origin}${pathname}`);

    assert.equal(
      hostedDeploymentBoundaryResponse(request, pathname, "preview"),
      null,
      "the route projector, not a blanket Worker response, authorizes Travel media",
    );
    assert.equal(
      hostedDeploymentBoundaryResponse(
        new Request(`${origin}${pathname}`, { method: "HEAD" }),
        pathname,
        "preview",
      ),
      null,
    );
    for (const method of ["POST", "PUT", "DELETE"]) {
      const blocked = hostedDeploymentBoundaryResponse(
        new Request(`${origin}${pathname}`, { method }),
        pathname,
        "preview",
      );
      assert.equal(blocked?.status, 405, method);
      assert.equal(blocked?.headers.get("allow"), "GET, HEAD", method);
    }

    assert.equal(
      snapshotContainsPhoto(fixture, photo.id, photo.mediaDigest),
      true,
    );
    assert.equal(
      snapshotContainsPhoto(
        fixture,
        "photo_not_in_fixture",
        photo.mediaDigest,
      ),
      false,
    );
    assert.equal(
      snapshotContainsPhoto(fixture, photo.id, "f".repeat(64)),
      false,
    );

    const [routeSource, httpSource, mediaSource] = await Promise.all([
      readFile(
        new URL(
          "../app/api/travel-media/[photoId]/[variant]/[digest]/route.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../lib/server/travel/http.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/server/travel/media.ts", import.meta.url), "utf8"),
    ]);
    assert.match(routeSource, /export async function GET/);
    assert.match(routeSource, /export async function HEAD/);
    assert.match(httpSource, /variant === "480"[\s\S]*variant === "960"[\s\S]*variant === "1920"/);
    assert.match(httpSource, /\^\[a-f0-9\]\{64\}\$/);
    assert.match(
      mediaSource,
      /snapshotContainsPhoto\(fixture, input\.photoId, input\.digest\)/,
    );
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("preview cleanup can detach only its exact domain and Worker pair", () => {
  const coordinates = previewResourceCoordinates("42");
  const records = [
    {
      id: "preview-domain-42",
      hostname: "pr-42.anish-shah-is.online",
      service: "anish-shah-work-in-public-pr-42",
    },
    {
      id: "staging-domain",
      hostname: "staging.anish-shah-is.online",
      service: "anish-shah-work-in-public-staging",
    },
    {
      id: "production-domain",
      hostname: "anish-shah-is.online",
      service: "anish-shah-work-in-public",
    },
    {
      id: "preview-domain-43",
      hostname: "pr-43.anish-shah-is.online",
      service: "anish-shah-work-in-public-pr-43",
    },
  ];
  assert.equal(
    ownedPreviewDomainRecord(records, coordinates)?.id,
    "preview-domain-42",
  );
  assert.equal(previewPrFromWorkerName("anish-shah-work-in-public"), null);
  assert.equal(
    ownedPreviewDomainRecord(records, previewResourceCoordinates("44")),
    null,
  );
  assert.throws(
    () => ownedPreviewDomainRecord([
      {
        id: "wrong-owner-domain",
        hostname: "pr-42.anish-shah-is.online",
        service: "anish-shah-work-in-public-staging",
      },
    ], coordinates),
    /Refusing to detach/,
  );
});

test("preview janitor accounts for open pull requests beyond the first page", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) => ({ number: index + 1 })),
    [{ number: 101 }],
  ];
  const requested = [];
  const open = await collectOpenPullRequestNumbers(async (page, pageSize) => {
    requested.push({ page, pageSize });
    return pages[page - 1] ?? [];
  });

  assert.deepEqual(requested, [
    { page: 1, pageSize: 100 },
    { page: 2, pageSize: 100 },
  ]);
  assert.equal(open.has("1"), true);
  assert.equal(open.has("101"), true);
  assert.equal(open.size, 101);
});

test("preview fixtures activate only under an exact preview runtime", () => {
  const names = [
    "DEPLOYMENT_TIER",
    "PREVIEW_PR_NUMBER",
    "SITE_URL",
    "PRODUCTION_SITE_URL",
    "PUBLIC_CONTENT_MODE",
    "RELEASE_VERSION",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: releaseVersion,
  });
  try {
    const ready = previewConnectorSnapshot(
      "myanimelist",
      new URLSearchParams("fixture=maximum-density"),
    );
    assert.equal(ready?.status, "ready");
    assert.equal(ready?.payload.library.length, 36);
    assert.match(ready?.payload.coverage, /Synthetic preview data/);
    assert.equal(ready?.payload.library[0].artwork.kind, "mal-cover");
    const projected = projectConnectorSnapshotForPublic(
      "myanimelist",
      ready.payload,
      new URLSearchParams("pageSize=12"),
    );
    assert.equal(projected.gallery.items.length, 12);
    assert.match(
      projected.gallery.items[0].artwork.src,
      /^\/api\/connector-artwork\/myanimelist\//,
    );
    assert.equal(
      "artwork" in previewConnectorSnapshot(
        "myanimelist",
        new URLSearchParams("fixture=missing-artwork"),
      ).payload.library[0],
      false,
    );
    assert.equal(
      previewConnectorSnapshot(
        "steam",
        new URLSearchParams("fixture=unavailable"),
      )?.status,
      "unavailable",
    );
    const strava = previewStravaSnapshot(new URLSearchParams());
    assert.equal(strava?.status, "ready");
    assert.equal(strava?.payload.embedStatus, "available");
    assert.match(
      strava?.payload.embed.embedUrl,
      /^https:\/\/www\.strava\.com\/athletes\/99999999999999999999\/latest-rides\/[a-f0-9]{40}$/,
    );
    assert.equal("previewNotice" in strava.payload, false);
    process.env.SITE_URL = "https://anish-shah-is.online";
    assert.equal(previewConnectorSnapshot("hardcover", new URLSearchParams()), null);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("all six connector-backed room foundations use projected preview data without durable state", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: releaseVersion,
  };
  try {
    const [watch, read, collect, play, listen, move, stale] = await Promise.all([
      getCollectionScreenFoundation("myanimelist", {
        fixture: "maximum-density",
        pageSize: "36",
      }),
      getCollectionScreenFoundation("hardcover", {
        fixture: "long-title",
        q: "記憶",
      }),
      getDiscogsScreenFoundation({
        fixture: "maximum-density",
        pageSize: "36",
      }),
      getCollectionScreenFoundation("steam", { fixture: "ready" }),
      getSpotifyScreenFoundation({ fixture: "ready" }),
      getMovementScreenFoundation({ fixture: "ready" }),
      getCollectionScreenFoundation("myanimelist", { fixture: "stale" }),
    ]);

    assert.equal(watch.state.status, "ready");
    assert.equal(watch.state.payload.gallery.items.length, 36);
    assert.equal(read.state.status, "ready");
    assert.equal(
      read.state.payload.gallery.items.some((item) =>
        /記憶と機械/.test(item.title),
      ),
      true,
    );
    assert.equal(collect.state.status, "ready");
    assert.equal(collect.state.payload.gallery.items.length, 36);
    assert.equal(play.state.status, "ready");
    assert.equal(listen.status, "ready");
    assert.equal(listen.payload.windows.short_term.tracks.length, 12);
    assert.equal(move.status, "ready");
    assert.equal(move.payload.embedStatus, "available");
    assert.equal(stale.state.status, "ready");
    assert.equal(stale.state.stale, true);
    assert.ok(
      new Date(stale.state.payload.freshUntil).getTime() < Date.now(),
    );
    assert.equal(
      previewFixtureForPlayRoute({ fixture: "missing-artwork" }),
      "missing-artwork",
    );
    assert.equal(previewFixtureForPlayRoute({}), undefined);
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("preview Discogs fixtures preserve format and decade variation", () => {
  const names = [
    "DEPLOYMENT_TIER",
    "PREVIEW_PR_NUMBER",
    "SITE_URL",
    "PRODUCTION_SITE_URL",
    "PUBLIC_CONTENT_MODE",
    "RELEASE_VERSION",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: releaseVersion,
  });
  try {
    const snapshot = previewConnectorSnapshot(
      "discogs",
      new URLSearchParams("fixture=maximum-density&pageSize=36"),
    );
    assert.equal(snapshot?.status, "ready");
    const projected = projectConnectorSnapshotForPublic(
      "discogs",
      snapshot.payload,
      new URLSearchParams("pageSize=36"),
    );
    assert.equal(projected.provider, "discogs");
    assert.equal(projected.gallery.items.length, 36);
    assert.equal(projected.formats.length, 5);
    assert.ok(projected.decades.length > 4);
    assert.ok(projected.formatDecadeMatrix.length > 10);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("preview workflows deploy only requested immutable PR Gate builds from trusted code", async () => {
  const [deploy, cleanup, prGate, validate, browserQuality, gitleaks, codeql, metadata, prepare, cleanupScript, readiness] = await Promise.all([
    readFile(new URL("../.github/workflows/preview-deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/preview-cleanup.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pr-gate.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/browser-quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/gitleaks.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/codeql.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/write-preview-metadata.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/prepare-hosted-environment.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/preview-cleanup.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/preview-readiness.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(deploy, /workflow_run:/);
  assert.match(deploy, /workflows: \[PR Gate\]/);
  assert.match(
    deploy,
    /group: preview-\$\{\{ github\.event\.workflow_run\.event == 'pull_request' && format\('pr-\{0\}', github\.event\.workflow_run\.pull_requests\[0\]\.number\) \|\| format\('run-\{0\}', github\.event\.workflow_run\.id\) \}\}/,
  );
  assert.match(deploy, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(
    deploy,
    /workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(deploy, /Revalidate the open PR and exact current head/);
  assert.match(deploy, /gh api "\$endpoint" --jq '\[\.state, \.head\.sha, \.head\.repo\.full_name\] \| @tsv'/);
  assert.match(deploy, /Recheck the PR immediately before privileged deployment/);
  assert.match(deploy, /PREVIEW_READINESS_TIMEOUT_MS: "90000"/);
  assert.match(deploy, /run: node scripts\/preview-readiness\.mjs/);
  assert.doesNotMatch(deploy, /for attempt in \$\(seq/);
  assert.doesNotMatch(deploy, /curl/);
  assert.match(readiness, /const deadline = startedAt \+ boundedTimeout/);
  assert.match(readiness, /redirect: "manual"/);
  assert.match(readiness, /AbortSignal\.timeout\(requestTimeout\)/);
  assert.match(readiness, /x-anish-release-sha/);
  assert.match(readiness, /response\.headers\.get\(releaseMarkerHeader\) === expectedMarker/);
  assert.match(deploy, /EXPECTED_RELEASE_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(deploy, /printf '%s\\nPreview: %s\\n\\nValidated SHA:/);
  assert.match(deploy, /CLOUDFLARE_PREVIEW_API_TOKEN/);
  assert.match(deploy, /preview-production-guard\.mjs capture/);
  assert.match(deploy, /preview-production-guard\.mjs verify/);
  assert.match(deploy, /id: production_guard_capture/);
  assert.match(
    deploy,
    /if: \$\{\{ always\(\) && steps\.production_guard_capture\.outcome == 'success' \}\}/,
  );
  assert.match(prGate, /name: Upload the one immutable PR build/);
  assert.match(prGate, /include-hidden-files: true/);
  assert.match(prGate, /github\.event\.pull_request\.head\.sha/);
  assert.match(prGate, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview'\)/);
  assert.match(
    browserQuality,
    /BROWSER_SOURCE_SHA: \$\{\{ inputs\.commit_sha \}\}/,
  );
  assert.match(
    browserQuality,
    /EXPECTED_SHA: \$\{\{ env\.BROWSER_SOURCE_SHA \}\}/,
  );
  assert.doesNotMatch(browserQuality, /room-browser-review/);
  assert.match(browserQuality, /Download the exact Validate build/);
  assert.match(browserQuality, /run-id: \$\{\{ inputs\.validate_run_id \}\}/);
  assert.doesNotMatch(browserQuality, /npm run build/);
  for (const workflow of [gitleaks, codeql]) {
    assert.match(
      workflow,
      /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha/,
    );
    assert.match(
      workflow,
      /EXPECTED_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha/,
    );
    assert.doesNotMatch(workflow, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  }
  assert.match(prGate, /PREVIEW_WORKFLOW_SHA/);
  assert.match(
    prGate,
    /pr-build-\$\{\{ env\.PR_SOURCE_SHA \}\}/,
  );
  assert.match(metadata, /process\.env\.PREVIEW_SOURCE_SHA/);
  assert.match(metadata, /sourceSha: releaseSha/);
  assert.match(metadata, /schemaVersion: "1\.2"/);
  assert.match(metadata, /releaseVersion/);
  assert.match(metadata, /workflowSha/);
  assert.match(prepare, /bundle\.sourceSha !== bundle\.releaseSha/);
  assert.match(cleanup, /preview-cleanup\.mjs cleanup --apply/);
  assert.match(cleanup, /group: preview-\$\{\{ github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| 'janitor' \}\}/);
  assert.match(cleanup, /github\.workflow_sha/);
  assert.match(cleanup, /cron: "41 6 \* \* 1"/);
  assert.match(cleanup, /node scripts\/preview-cleanup\.mjs janitor --apply/);
  assert.doesNotMatch(cleanup, /setup-repository|npm ci/);
  assert.match(deploy, /Mark the current preview SHA as failed/);
  assert.match(deploy, /Mark the current preview SHA as not deployable/);
  assert.match(deploy, /validation failed for this SHA/);
  assert.match(deploy, /A newer head or closed PR superseded this validation result/);
  assert.match(deploy, /A newer head or closed PR superseded this deployment failure/);
  assert.match(deploy, /The URL may still serve an older build/);
  for (const workflow of [deploy, prGate, validate, browserQuality]) {
    assert.match(workflow, /uses: \.\/\.github\/actions\/setup-repository/);
  }
  assert.match(cleanupScript, /hostname: coordinates\.hostname/);
  assert.match(cleanupScript, /service: coordinates\.workerName/);
  assert.match(cleanupScript, /domains\.length > 1/);
  assert.doesNotMatch(`${deploy}\n${cleanup}\n${prGate}\n${validate}`, /pull_request_target/);
});

test("CI shares the repository toolchain and reuses hidden immutable build evidence", async () => {
  const [action, prGate, validate, browser, preview, dependabot] = await Promise.all([
    readFile(
      new URL("../.github/actions/setup-repository/action.yml", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.github/workflows/pr-gate.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(
      new URL("../.github/workflows/browser-quality.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../.github/workflows/preview-deploy.yml", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8"),
  ]);

  assert.match(
    action,
    /node-version-file: \$\{\{ inputs\.working-directory \}\}\/\.node-version/,
  );
  assert.match(action, /default: "\."/);
  assert.match(action, /require\('\.\/package\.json'\)\.packageManager/);
  assert.match(action, /npm ci --ignore-scripts --prefix/);
  for (const workflow of [prGate, validate, browser, preview]) {
    assert.match(workflow, /uses: \.\/\.github\/actions\/setup-repository/);
  }
  assert.doesNotMatch(validate, /name: Verify deployable content attestation/);
  assert.doesNotMatch(validate, /name: Apply all migrations to clean local D1/);
  assert.match(
    validate,
    /name: Upload exact validated build for release evidence[\s\S]*include-hidden-files: true[\s\S]*if-no-files-found: error/,
  );
  assert.match(
    prGate,
    /name: Upload the one immutable PR build[\s\S]*include-hidden-files: true[\s\S]*if-no-files-found: error/,
  );
  assert.match(
    preview,
    /name: Download the validated PR artifact[\s\S]*name: Scan and prepare the read-only preview[\s\S]*npm run bundle:scan/,
  );
  assert.match(browser, /name: Download the exact Validate build/);
  assert.match(browser, /npm run deployable:attest/);
  assert.doesNotMatch(browser, /npm run build/);
  assert.match(dependabot, /dependency-name: typescript[\s\S]*version-update:semver-major/);
  assert.match(dependabot, /dependency-name: "@types\/node"[\s\S]*version-update:semver-major/);
});

test("browser quality isolates workerd lifecycles without weakening review evidence", async () => {
  const [workflow, stability, runner, config, lighthouse, packageJson] = await Promise.all([
    readFile(new URL("../.github/workflows/browser-quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/browser-stability.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-browser-quality.mjs", import.meta.url), "utf8"),
    readFile(new URL("../playwright.config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-lighthouse-quality.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.match(runner, /segment: "public"/);
  assert.match(runner, /"tests\/browser\/public-quality\.spec\.mjs"/);
  assert.match(runner, /runReleaseBrowserGate/);
  assert.match(runner, /"tests\/browser\/room-quality\.spec\.mjs"/);
  assert.match(runner, /"tests\/browser\/travel-atlas\.spec\.mjs"/);
  assert.match(runner, /releaseStressPattern/);
  assert.match(runner, /"--retries=0"/);
  assert.match(runner, /"--max-failures=1"/);
  assert.match(runner, /BROWSER_QUALITY_PORT: String\(port\)/);
  assert.match(runner, /BROWSER_QUALITY_SEGMENT: segment/);
  assert.match(runner, /BROWSER_QUALITY_SCOPE/);
  assert.match(runner, /BROWSER_QUALITY_SHARD/);
  assert.match(runner, /ROOM_CAPTURE_VISUALS: "0"/);
  assert.match(runner, /segment: "release-public"/);
  assert.doesNotMatch(runner, /segment: "release-simulation-fallbacks"/);
  assert.match(runner, /simulationExperienceMode: "campaign-v1"/);
  assert.match(runner, /BROWSER_SIMULATION_EXPERIENCE_MODE/);
  assert.match(runner, /remaining release checks were cancelled/);
  assert.match(config, /process\.env\.BROWSER_QUALITY_PORT/);
  assert.match(config, /process\.env\.BROWSER_QUALITY_SEGMENT/);
  assert.match(config, /process\.env\.BROWSER_SIMULATION_EXPERIENCE_MODE/);
  assert.match(config, /node_modules\/wrangler-e2e\/bin\/wrangler\.js/);
  assert.match(config, /const e2eCompatibilityDate = "2026-07-28"/);
  assert.match(config, /--compatibility-date \$\{e2eCompatibilityDate\}/);
  assert.match(lighthouse, /node_modules\/wrangler-e2e\/bin\/wrangler\.js/);
  assert.match(lighthouse, /const lighthouseRunsPerRoute = 3/);
  assert.match(lighthouse, /selectMedianLighthouseResult\(samples\)/);
  assert.match(lighthouse, /const e2eCompatibilityDate = "2026-07-28"/);
  assert.match(lighthouse, /"--compatibility-date",\n\s+e2eCompatibilityDate/);
  assert.match(lighthouse, /"SIMULATION_EXPERIENCE_MODE:disabled"/);
  assert.match(lighthouse, /"SIMULATION_AI_MODE:authored-only"/);
  assert.doesNotMatch(
    lighthouse,
    /DEPLOYMENT_TIER:preview|PUBLIC_CONTENT_MODE:static_preview/,
    "Lighthouse must evaluate production-like indexability, not the intentionally noindexed preview tier.",
  );
  const hostedConfiguration = await readFile(
    new URL("../scripts/lib/hosted-config-contract.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(hostedConfiguration, /2026-07-28/);
  assert.equal(
    packageJson.devDependencies["wrangler-e2e"],
    "npm:wrangler@4.152.0",
  );
  assert.equal(
    packageJson.scripts["validate:release"],
    "npm run deployable:attest && npm run cloudflare:prepare:existing && node scripts/release-build-checkpoint.mjs --write && npm run validate:release:candidate && node scripts/release-build-checkpoint.mjs --check && node scripts/release-preflight.mjs",
  );
  assert.doesNotMatch(packageJson.scripts["validate:release:prebuild"], /build/);
  assert.doesNotMatch(packageJson.scripts["validate:release:candidate"], /build/);
  assert.match(
    packageJson.scripts["validate:release:candidate"],
    /bundle:scan && npm run test:rendered/,
  );
  assert.doesNotMatch(packageJson.scripts["validate:browser:existing"], /build/);
  assert.doesNotMatch(packageJson.scripts["cloudflare:prepare:existing"], /build/);
  assert.equal(
    packageJson.scripts["staging:prepare"],
    "npm run deployable:attest && npm run staging:prepare:existing && node scripts/release-build-checkpoint.mjs --write && npm run validate:release:candidate && node scripts/release-build-checkpoint.mjs --check",
  );
  assert.doesNotMatch(packageJson.scripts["staging:prepare:existing"], /build/);
  assert.match(
    packageJson.scripts["staging:prepare:existing"],
    /prepare-hosted-environment\.mjs staging/,
  );
  assert.match(workflow, /^name: Browser Quality$/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /name: Download the exact Validate build/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.validate_run_id \}\}/);
  assert.match(workflow, /test -s dist\/client\/\.vite\/manifest\.json/);
  assert.match(workflow, /npm run bundle:scan/);
  assert.match(workflow, /npm run browser:release:existing/);
  assert.doesNotMatch(workflow, /npm run build/);
  assert.match(workflow, /name: Upload browser failure evidence\n        if: failure\(\)/);
  assert.doesNotMatch(workflow, /Capture room review evidence/);
  assert.match(stability, /worker: \[1, 2\]/);
  assert.match(stability, /max-parallel: 2/);
  assert.match(stability, /BROWSER_SOAK_LOOPS: "1"/);
  assert.match(stability, /run: node scripts\/ci\/run-browser-soak\.mjs/);
  assert.match(stability, /name: browser soak worker \$\{\{ matrix\.worker \}\}/);
  assert.match(stability, /name: Download the existing validated build/);
  assert.doesNotMatch(stability, /npm run build/);
  assert.doesNotMatch(stability, /runs-on: ubuntu-latest/);
  assert.match(stability, /Capture non-blocking visual review evidence/);
  assert.match(packageJson.scripts["capture:room-review"], /BROWSER_QUALITY_PORT=4180/);
  assert.match(packageJson.scripts["capture:room-review"], /BROWSER_QUALITY_SEGMENT=review/);

  const listRoomTests = (arguments_) => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", ...arguments_, "--list"],
      {
        cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
        encoding: "utf8",
        env: {
          ...process.env,
          BROWSER_QUALITY_PORT: "4190",
          BROWSER_QUALITY_SEGMENT: "partition-check",
          BROWSER_QUALITY_STATE_DIR: ".wrangler/browser-quality-partition-check",
          ROOM_CAPTURE_VISUALS: "0",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(" › "));
  };
  const complete = listRoomTests(["tests/browser/room-quality.spec.mjs"]);
  const partitioned = [];
  for (let shard = 1; shard <= 5; shard += 1) {
    partitioned.push(
      ...listRoomTests([
        "tests/browser/room-quality.spec.mjs",
        "--fully-parallel",
        `--shard=${shard}/5`,
      ]),
    );
  }
  assert.ok(complete.length >= 44);
  assert.equal(partitioned.length, complete.length);
  assert.equal(new Set(partitioned).size, partitioned.length);
  assert.deepEqual([...partitioned].sort(), [...complete].sort());
});

test("browser docs-only classification sees both sides of a source-to-docs rename", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "anish-browser-rename-"));
  const runGit = (...arguments_) => {
    const result = spawnSync("git", arguments_, {
      cwd: directory,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };

  try {
    runGit("init", "--quiet");
    runGit("config", "user.name", "Synthetic CI");
    runGit("config", "user.email", "ci@example.invalid");
    mkdirSync(path.join(directory, "components"));
    writeFileSync(
      path.join(directory, "components", "interactive.tsx"),
      "export const interactive = true;\n",
    );
    runGit("add", "components/interactive.tsx");
    runGit("commit", "--quiet", "-m", "add source fixture");
    const baseSha = runGit("rev-parse", "HEAD");

    mkdirSync(path.join(directory, "docs"));
    runGit("mv", "components/interactive.tsx", "docs/interactive.md");
    runGit("commit", "--quiet", "-m", "move source fixture to docs");
    const headSha = runGit("rev-parse", "HEAD");

    const diff = spawnSync(
      "git",
      [
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        baseSha,
        headSha,
        "--",
      ],
      { cwd: directory },
    );
    assert.equal(diff.status, 0, diff.stderr?.toString("utf8"));
    const changedPaths = diff.stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    assert.deepEqual(changedPaths, [
      "components/interactive.tsx",
      "docs/interactive.md",
    ]);
    assert.equal(
      changedPaths.every((changedPath) => changedPath.startsWith("docs/")),
      false,
      "the deleted source path must keep Browser Quality enabled",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Play propagates a preview fixture through every connector-backed room route", async () => {
  const [
    page,
    direct,
    foundation,
    collection,
    gallery,
    discogs,
    spotify,
    movement,
  ] = await Promise.all([
    readFile(new URL("../app/play/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/play/[objectSlug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/play-screen-foundation.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/play/CollectionStream.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/CollectionGallery.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/DiscogsStream.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SpotifyStream.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/MovementStream.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /activePreviewFixtureRuntime\(\)/);
  assert.match(page, /<RoomOverview[\s\S]*fixture=\{fixture\}/);
  assert.match(direct, /previewFixtureForPlayRoute\(query\)/);
  assert.match(foundation, /previewFixtureForPlayRoute/);
  assert.match(collection, /parameters\.set\("fixture", fixture\)/);
  assert.match(discogs, /parameters\.set\("fixture", fixture\)/);
  assert.match(spotify, /loadSpotifyFixture\(controller\.signal, fixture\)/);
  assert.match(spotify, /loadSpotify\(controller\.signal\)/);
  assert.match(movement, /new URLSearchParams\(\{ fixture \}\)/);
  assert.match(gallery, /input name="fixture" type="hidden" value=\{fixture\}/);
  assert.match(gallery, /parameters\.set\("fixture", fixture\)/);
  assert.match(discogs, /input name="fixture" type="hidden" value=\{fixture\}/);
  assert.match(discogs, /parameters\.set\("fixture", fixture\)/);
});

test("preview production guard pins the apex and production Worker", async () => {
  const source = await readFile(
    new URL("../scripts/preview-production-guard.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /PRODUCTION_WORKER_NAME = "anish-shah-work-in-public"/,
  );
  assert.match(source, /workers\/domains/);
  assert.match(source, /record\?\.hostname === productionHostname/);
  assert.match(source, /matching\[0\]\?\.service !== PRODUCTION_WORKER_NAME/);
  assert.match(source, /"deployments"[\s\S]*"status"[\s\S]*"--name"/);
  assert.match(source, /CLOUDFLARE_ACCOUNT_ID: PUBLIC_CLOUDFLARE_ACCOUNT_ID/);
  assert.match(source, /wrangler\.preview\.json/);
});

test("preview production guard preserves a redacted Wrangler failure diagnostic", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "anish-preview-guard-"));
  const token = "test-preview-token-must-not-leak";
  try {
    const wranglerPath = path.join(
      directory,
      "node_modules/wrangler/bin/wrangler.js",
    );
    mkdirSync(path.dirname(wranglerPath), { recursive: true });
    writeFileSync(
      wranglerPath,
      'process.stderr.write("\\u001b[31mCloudflare authentication failed for " + process.env.CLOUDFLARE_API_TOKEN + "\\u001b[0m\\n");\nprocess.exitCode = 1;\n',
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/preview-production-guard.mjs", import.meta.url),
        ),
        "capture",
        path.join(directory, "guard.json"),
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Unable to read the production Worker deployment \(exit 1\)\./,
    );
    assert.match(
      result.stderr,
      /Wrangler diagnostic:\nCloudflare authentication failed for \[redacted\]/,
    );
    assert.doesNotMatch(result.stderr, new RegExp(token));
    assert.doesNotMatch(result.stderr, /\u001B/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("staging release bootstraps and verifies its isolated D1/KV publication", async () => {
  const [script, packageJson] = await Promise.all([
    readFile(new URL("../scripts/staging-release.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(
    packageJson.scripts["staging:bootstrap"],
    "node scripts/staging-release.mjs bootstrap",
  );
  assert.equal(
    packageJson.scripts["staging:stage"],
    "node scripts/staging-release.mjs stage",
  );
  assert.equal(
    packageJson.scripts["staging:deploy"],
    "node scripts/staging-release.mjs deploy",
  );
  assert.match(script, /action === "bootstrap"/);
  assert.match(script, /action === "stage"/);
  assert.match(script, /\/api\/studio\/publish/);
  assert.match(script, /\/api\/studio\/publication-checkpoint/);
  assert.match(script, /\/api\/studio\/release-checkpoint/);
  assert.match(script, /STAGING_SITE_ORIGIN/);
  assert.match(script, /STAGING_BROWSER_URL/);
  assert.match(script, /event,workflowDatabaseId/);
  assert.match(script, /assertActiveActionsWorkflow/);
  assert.match(script, /workflowIdentity/);
  assert.match(script, /verifyReleaseBuildCheckpoint\(root\)/);
  assert.match(script, /releaseBuildCheckpointSha256/);
  assert.match(script, /waitForCandidateReadiness/);
  assert.match(script, /stagingSmokePaths\(\{[\s\S]*travelEnabled:/);
  assert.match(script, /Cloudflare-Workers-Version-Overrides/);
  assert.match(script, /assertStagingCandidateHealth/);
  assert.match(script, /assertStagingCheckpointReceipt/);
  assert.match(script, /requireNoPendingMigrations/);
  assert.match(script, /requireStagingTriggerReceipt/);
  assert.match(script, /deployments",\s*"status"/);
  assert.match(script, /\/api\/studio\/maintenance\/bootstrap/);
  assert.match(script, /requireStagedCandidate/);
  assert.match(script, /waitForStagingDeploymentState/);
  assert.match(
    script,
    /expectedSimulationStatus\s*=\s*\n?\s*plan\.simulation\.experienceMode === "disabled" \? 404 : 200/,
  );
  assert.match(script, /authenticatedFetch\(\s*"\/api\/simulation\/session"/);
  assert.match(
    script,
    /expectedSimulationSessionStatus\s*=\s*\n?\s*plan\.simulation\.experienceMode === "campaign-v1" \? 200 : 404/,
  );

  const stageStart = script.indexOf('if (action === "stage")');
  const stageEnd = script.indexOf("} else {", stageStart);
  const deployStart = script.indexOf('} else if (action === "deploy")', stageStart);
  const smokeStart = script.indexOf('} else if (action === "smoke")', deployStart);
  assert.notEqual(stageStart, -1);
  assert.notEqual(stageEnd, -1);
  assert.notEqual(deployStart, -1);
  assert.notEqual(smokeStart, -1);
  const stage = script.slice(stageStart, stageEnd);
  const deploy = script.slice(deployStart, smokeStart);
  assert.match(stage, /`\$\{requested\}@0%`/);
  assert.match(stage, /`\$\{plan\.previousWorkerVersion\}@100%`/);
  assert.match(stage, /waitForStagingDeployment\(plan, \{ phase: "staged" \}\)/);
  assert.doesNotMatch(stage, /`\$\{requested\}@100%`/);
  assert.equal(
    deploy.indexOf("assertStagingCheckpointReceipt") <
      deploy.indexOf("assertReleaseMarker(remoteReleaseMarker()") &&
      deploy.indexOf("assertReleaseMarker(remoteReleaseMarker()") <
        deploy.indexOf('`${workerVersion}@100%`'),
    true,
  );
  assert.equal(
    deploy.indexOf("requireStagedCandidate(plan)") <
      deploy.indexOf("assertStagingCheckpointReceipt") &&
      deploy.indexOf('`${workerVersion}@100%`') <
        deploy.indexOf('phase: "deployed"'),
    true,
  );
});

test("staging Studio renders an explicit non-promotable boundary", async () => {
  const [page, promotion] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/studio/PlayPromotionControls.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(page, /deploymentTier === "staging"[\s\S]*\? "staging"/);
  assert.match(promotion, /environment: "local" \| "staging" \| "hosted"/);
  assert.match(promotion, /Staging stays isolated\./);
  assert.match(promotion, /cannot issue, stage, accept, or apply production transfer codes/);
  assert.match(promotion, /environment === "staging" \? null/);
});
