export const STAGING_TRIGGER_RECEIPT_PATH =
  "dist/staging-trigger-deployment.json";
export const STAGING_CHECKPOINT_RECEIPT_PATH =
  "dist/staging-candidate-checkpoint.json";

const SHA_40 = /^[a-f0-9]{40}$/;
const SHA_64 = /^[a-f0-9]{64}$/;
const VERSION_ID = /^[A-Za-z0-9_-]{8,160}$/;
const CLEAN_MIGRATION_ACTIONS = new Set([
  "stage",
  "bootstrap",
  "checkpoint",
  "deploy",
  "smoke",
]);

export function stagingActionRequiresCleanMigrations(action) {
  return CLEAN_MIGRATION_ACTIONS.has(action);
}

function stagingTraffic(deployment) {
  if (
    !deployment ||
    typeof deployment !== "object" ||
    !VERSION_ID.test(deployment.id ?? "") ||
    deployment.strategy !== "percentage" ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length < 1 ||
    deployment.versions.length > 2
  ) {
    throw new Error("The staging Worker deployment status is malformed.");
  }
  const traffic = deployment.versions.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !VERSION_ID.test(entry.version_id ?? "") ||
      typeof entry.percentage !== "number" ||
      !Number.isFinite(entry.percentage) ||
      entry.percentage < 0 ||
      entry.percentage > 100
    ) {
      throw new Error("The staging Worker traffic allocation is malformed.");
    }
    return {
      versionId: entry.version_id,
      percentage: entry.percentage,
    };
  });
  if (
    new Set(traffic.map((entry) => entry.versionId)).size !== traffic.length ||
    traffic.reduce((total, entry) => total + entry.percentage, 0) !== 100
  ) {
    throw new Error("The staging Worker traffic allocation is ambiguous.");
  }
  return traffic.sort((left, right) =>
    left.versionId.localeCompare(right.versionId),
  );
}

export function assertStagingDeployment(
  deployment,
  { candidateVersion, priorVersion = null, phase },
) {
  if (!VERSION_ID.test(candidateVersion ?? "")) {
    throw new Error("The staging candidate Worker version is invalid.");
  }
  const traffic = stagingTraffic(deployment);
  const expected =
    phase === "staged"
      ? [
          { versionId: candidateVersion, percentage: 0 },
          { versionId: priorVersion, percentage: 100 },
        ]
      : phase === "deployed"
        ? [{ versionId: candidateVersion, percentage: 100 }]
        : null;
  if (
    !expected ||
    (phase === "staged" &&
      (!VERSION_ID.test(priorVersion ?? "") ||
        priorVersion === candidateVersion))
  ) {
    throw new Error("The expected staging Worker deployment is invalid.");
  }
  expected.sort((left, right) => left.versionId.localeCompare(right.versionId));
  if (JSON.stringify(traffic) !== JSON.stringify(expected)) {
    throw new Error(
      phase === "staged"
        ? "The staging candidate is not isolated at 0% beside the 100% prior version."
        : "The staging candidate is not the sole 100% deployed version.",
    );
  }
  return {
    deploymentId: deployment.id,
    phase,
    traffic,
  };
}

export async function waitForStagingDeploymentState({
  readDeployment,
  waitForReadiness,
  candidateVersion,
  priorVersion = null,
  phase,
}) {
  if (
    typeof readDeployment !== "function" ||
    typeof waitForReadiness !== "function"
  ) {
    throw new Error("Staging deployment polling requires read-only adapters.");
  }
  let accepted = null;
  await waitForReadiness({
    check: async () => {
      try {
        const deployment = await readDeployment();
        const state = assertStagingDeployment(deployment, {
          candidateVersion,
          priorVersion,
          phase,
        });
        accepted = { deployment, state };
        return true;
      } catch {
        return false;
      }
    },
  });
  if (!accepted) {
    throw new Error("The staging Worker deployment did not converge.");
  }
  return accepted;
}

function canonicalIso(value, name) {
  const date = new Date(value ?? "");
  if (!value || Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp.`);
  }
  return value;
}

function digest(value, name) {
  if (!SHA_64.test(value ?? "")) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return value;
}

function exactArray(value, name) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${name} must contain unique non-empty strings.`);
  }
  return [...value];
}

export function createStagingTriggerReceipt({
  head,
  configSha256,
  appliedAt,
}) {
  if (!SHA_40.test(head ?? "")) {
    throw new Error("The staging trigger receipt requires the exact commit SHA.");
  }
  return {
    schemaVersion: "1.0",
    appliedAt: canonicalIso(appliedAt, "appliedAt"),
    commitSha: head,
    workerName: "anish-shah-work-in-public-staging",
    preparedWorkerConfigSha256: digest(
      configSha256,
      "preparedWorkerConfigSha256",
    ),
    appliedBy: "wrangler_triggers_deploy",
    crons: ["47 * * * *"],
  };
}

export function assertStagingTriggerReceipt(
  receipt,
  { head, configSha256, notBefore },
) {
  const expected = createStagingTriggerReceipt({
    head,
    configSha256,
    appliedAt: receipt?.appliedAt,
  });
  if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
    throw new Error(
      "The staging trigger receipt is missing, stale, or does not match this release.",
    );
  }
  if (
    Date.parse(expected.appliedAt) <
    Date.parse(canonicalIso(notBefore, "notBefore"))
  ) {
    throw new Error("The staging triggers predate this release plan.");
  }
  return expected;
}

export function assertStagingCandidateHealth(body, { head, plan }) {
  if (
    body?.status !== "healthy" ||
    body?.releaseSha !== head ||
    body?.releaseVersion !== plan.releaseVersion ||
    body?.contentVersion !== plan.contentVersion ||
    body?.copyVersion !== plan.copyVersion
  ) {
    throw new Error(
      "Staging health is not healthy or does not match the planned SHA and versions.",
    );
  }

  const simulation = body.simulation;
  if (
    !simulation ||
    simulation.campaignVersion !== plan.simulation.campaignVersion ||
    simulation.experienceMode !== plan.simulation.experienceMode ||
    simulation.aiMode !== plan.simulation.aiMode ||
    simulation.provider !== plan.simulation.provider ||
    simulation.model !== plan.simulation.model ||
    (plan.simulation.experienceMode === "campaign-v1" &&
      (simulation.configured !== true ||
        simulation.providerApprovalDigest !==
          plan.simulation.approvalStateDigest ||
        JSON.stringify(simulation.approvedProviders) !==
          JSON.stringify(plan.simulation.approvedProviders)))
  ) {
    throw new Error(
      "Staging Simulation configuration or provider approvals do not match the plan.",
    );
  }

  const travel = body.travel;
  if (plan.travelAtlasMode === "atlas-v1") {
    if (
      !travel ||
      travel.mode !== "atlas-v1" ||
      travel.configured !== true ||
      !SHA_64.test(travel.activePublication?.contentHash ?? "") ||
      travel.cleanupHeartbeat?.status !== "current"
    ) {
      throw new Error(
        "Staging Travel is not configured, published, and current for atlas-v1.",
      );
    }
  } else if (plan.travelAtlasMode !== "disabled" || travel?.mode !== "disabled") {
    throw new Error("Staging Travel mode does not match the disabled plan.");
  }

  return {
    copyVersion: body.copyVersion,
    simulation: {
      approvedProviders:
        plan.simulation.experienceMode === "campaign-v1"
          ? exactArray(simulation.approvedProviders, "approvedProviders")
          : [],
      approvalStateDigest:
        plan.simulation.experienceMode === "campaign-v1"
          ? digest(
              simulation.providerApprovalDigest,
              "providerApprovalDigest",
            )
          : null,
    },
    travel: {
      mode: plan.travelAtlasMode,
      contentHash:
        plan.travelAtlasMode === "atlas-v1"
          ? travel.activePublication.contentHash
          : null,
      cleanupHeartbeat:
        plan.travelAtlasMode === "atlas-v1" ? "current" : "not_applicable",
    },
  };
}

export function assertStagingPublication(publication, plan) {
  if (
    publication?.status !== "ready" ||
    publication?.contentVersion !== plan.contentVersion ||
    publication?.kvPointerMatches !== true ||
    !SHA_64.test(publication?.contentHash ?? "")
  ) {
    throw new Error("Staging publication checkpoint is not ready.");
  }
  return { contentHash: publication.contentHash };
}

export function createStagingCheckpointReceipt({
  head,
  workerVersion,
  planSha256,
  plan,
  health,
  publication,
  deployment,
  checkedAt,
}) {
  if (!SHA_40.test(head ?? "") || !VERSION_ID.test(workerVersion ?? "")) {
    throw new Error("The staging checkpoint requires exact source and Worker versions.");
  }
  const healthState = assertStagingCandidateHealth(health, { head, plan });
  const publicationState = assertStagingPublication(publication, plan);
  const deploymentState = assertStagingDeployment(deployment, {
    candidateVersion: workerVersion,
    priorVersion: plan.previousWorkerVersion,
    phase: "staged",
  });
  return {
    schemaVersion: "1.0",
    checkedAt: canonicalIso(checkedAt, "checkedAt"),
    commitSha: head,
    workerVersion,
    planSha256: digest(planSha256, "planSha256"),
    releaseVersion: plan.releaseVersion,
    contentVersion: plan.contentVersion,
    copyVersion: healthState.copyVersion,
    deploymentId: deploymentState.deploymentId,
    deploymentTraffic: deploymentState.traffic,
    publicationContentHash: publicationState.contentHash,
    simulation: healthState.simulation,
    travel: healthState.travel,
  };
}

export function assertStagingCheckpointReceipt(
  receipt,
  {
    head,
    workerVersion,
    planSha256,
    plan,
    health,
    publication,
    deployment,
    notBefore,
  },
) {
  const expected = createStagingCheckpointReceipt({
    head,
    workerVersion,
    planSha256,
    plan,
    health,
    publication,
    deployment,
    checkedAt: receipt?.checkedAt,
  });
  if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
    throw new Error(
      "The staging candidate checkpoint is missing, stale, or does not match current state.",
    );
  }
  if (
    Date.parse(expected.checkedAt) <
    Date.parse(canonicalIso(notBefore, "notBefore"))
  ) {
    throw new Error("The staging candidate checkpoint predates this release plan.");
  }
  return expected;
}

export async function assertFreshStagingPromotionCheckpoint({
  readDeployment,
  readCandidateState,
  checkpointReceipt,
  expected,
}) {
  if (
    typeof readDeployment !== "function" ||
    typeof readCandidateState !== "function"
  ) {
    throw new Error(
      "Staging promotion revalidation requires read-only state adapters.",
    );
  }
  const deployment = await readDeployment();
  const candidateState = await readCandidateState();
  if (
    !candidateState ||
    typeof candidateState !== "object" ||
    !candidateState.health ||
    !candidateState.publication
  ) {
    throw new Error("The fresh staging candidate state is malformed.");
  }
  const receipt = assertStagingCheckpointReceipt(checkpointReceipt, {
    ...expected,
    health: candidateState.health,
    publication: candidateState.publication,
    deployment,
  });
  return {
    deployment,
    health: candidateState.health,
    publication: candidateState.publication,
    receipt,
  };
}
