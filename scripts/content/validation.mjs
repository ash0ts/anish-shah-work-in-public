/** Referential-integrity and privacy validators for generated bundles. */
function assertUniqueIds(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`Duplicate ${label} ID: ${value.id}`);
    seen.add(value.id);
  }
}

export function assertBundleIntegrity(
  bundle,
  {
    publicOnly = false,
    countBy,
    expectedFootprintRows,
    expectedImpactRows,
    approvedMetricCount,
  } = {},
) {
  const expectedSummary = {
    footprintRows: expectedFootprintRows,
    impactRows: expectedImpactRows,
    supplementalArtifacts: bundle.items.filter((item) => !item.id.startsWith("item:fp-")).length,
    publicItems: bundle.items.length,
    approvedMetricCount,
    footprintBackedUniqueWorks: bundle.entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        (entity.sourceBasis === "footprint" || entity.sourceBasis === "mixed"),
    ).length,
    supplementalUniqueWorks: bundle.entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        entity.sourceBasis === "supplemental",
    ).length,
  };
  for (const [field, expected] of Object.entries(expectedSummary)) {
    if (bundle.sourceSummary[field] !== expected) {
      throw new Error(
        `Source summary ${field} mismatch: expected ${expected}, found ${bundle.sourceSummary[field]}`,
      );
    }
  }

  for (const [label, values] of Object.entries({
    item: bundle.items,
    entity: bundle.entities,
    workGroup: bundle.workGroups,
    metric: bundle.metrics,
    metricGroup: bundle.metricGroups,
    groupingLedgerEntry: bundle.groupingLedger?.entries || [],
    evidence: bundle.evidence,
    relation: bundle.relations,
    collection: bundle.collections,
    narrative: bundle.narratives,
    snapshot: bundle.sourceSnapshots,
    organization: bundle.organizations,
  })) {
    assertUniqueIds(values, label);
  }

  const itemIds = new Set(bundle.items.map((item) => item.id));
  const entityIds = new Set(bundle.entities.map((entity) => entity.id));
  const metricIds = new Set(bundle.metrics.map((metric) => metric.id));
  const workGroupIds = new Set(bundle.workGroups.map((group) => group.id));
  const evidenceIds = new Set(bundle.evidence.map((evidence) => evidence.id));
  const organizationIds = new Set(bundle.organizations.map((organization) => organization.id));
  const collectionIds = new Set(bundle.collections.map((collection) => collection.id));
  const subjects = new Set([
    ...itemIds,
    ...entityIds,
    ...workGroupIds,
    ...collectionIds,
    bundle.profile.id,
    ...organizationIds,
  ]);

  for (const item of bundle.items) {
    if (!entityIds.has(item.canonicalEntityId)) {
      throw new Error(`Item ${item.id} has missing canonical entity ${item.canonicalEntityId}`);
    }
    for (const organizationId of item.organizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(`Item ${item.id} has missing organization ${organizationId}`);
      }
    }
    for (const evidenceId of item.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Item ${item.id} has missing evidence ${evidenceId}`);
      }
    }
  }
  for (const entity of bundle.entities) {
    if (entity.primaryItemId && !itemIds.has(entity.primaryItemId)) {
      throw new Error(`Entity ${entity.id} has missing primary item ${entity.primaryItemId}`);
    }
    for (const itemId of entity.itemIds) {
      if (!itemIds.has(itemId)) throw new Error(`Entity ${entity.id} has missing item ${itemId}`);
    }
    for (const parentEntityId of entity.parentEntityIds) {
      if (!entityIds.has(parentEntityId)) {
        throw new Error(`Entity ${entity.id} has missing parent ${parentEntityId}`);
      }
    }
    for (const organizationId of entity.organizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(`Entity ${entity.id} has missing organization ${organizationId}`);
      }
    }
  }
  const eligibleEntityIds = new Set(
    bundle.entities
      .filter(
        (entity) =>
          entity.publicationState === "public" &&
          entity.countability === "unique_work",
      )
      .map((entity) => entity.id),
  );
  const eligibleMembership = countBy(
    bundle.workGroups.flatMap((group) =>
      group.memberEntityIds.filter((entityId) => eligibleEntityIds.has(entityId)),
    ),
    (entityId) => entityId,
  );
  for (const entityId of eligibleEntityIds) {
    if (eligibleMembership.get(entityId) !== 1) {
      throw new Error(`Eligible entity ${entityId} is not assigned to one WorkGroup`);
    }
  }
  for (const group of bundle.workGroups) {
    if (!group.memberEntityIds.includes(group.primaryEntityId)) {
      throw new Error(`WorkGroup ${group.id} lacks its primary entity`);
    }
    for (const entityId of [
      ...group.memberEntityIds,
      ...group.programEntityIds,
      ...group.contextEntityIds,
    ]) {
      if (!entityIds.has(entityId)) {
        throw new Error(`WorkGroup ${group.id} has missing entity ${entityId}`);
      }
    }
    if (
      group.programEntityIds.some(
        (entityId) =>
          bundle.entities.find((entity) => entity.id === entityId)?.kind !== "program",
      )
    ) {
      throw new Error(`WorkGroup ${group.id} has a non-program program parent`);
    }
    for (const itemId of group.itemIds) {
      if (!itemIds.has(itemId)) {
        throw new Error(`WorkGroup ${group.id} has missing item ${itemId}`);
      }
    }
    for (const organizationId of group.organizationIds) {
      if (!organizationIds.has(organizationId)) {
        throw new Error(`WorkGroup ${group.id} has missing organization`);
      }
    }
    if (
      group.yearStart !== null &&
      group.yearEnd !== null &&
      group.yearStart > group.yearEnd
    ) {
      throw new Error(`WorkGroup ${group.id} has an inverted period`);
    }
  }
  for (const metric of bundle.metrics) {
    if (!subjects.has(metric.subjectId)) {
      throw new Error(`Metric ${metric.id} has missing subject ${metric.subjectId}`);
    }
    const ids = "publicEvidenceIds" in metric ? metric.publicEvidenceIds : metric.evidenceIds;
    for (const evidenceId of ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Metric ${metric.id} has missing evidence ${evidenceId}`);
      }
    }
  }
  for (const relation of bundle.relations) {
    if (!itemIds.has(relation.fromId) || !itemIds.has(relation.toId)) {
      throw new Error(`Relation ${relation.id} has a missing item target`);
    }
  }
  for (const collection of bundle.collections) {
    for (const itemId of collection.itemIds) {
      if (!itemIds.has(itemId)) throw new Error(`Collection ${collection.id} missing item ${itemId}`);
    }
    for (const metricId of collection.metricIds) {
      if (!metricIds.has(metricId)) {
        throw new Error(`Collection ${collection.id} missing metric ${metricId}`);
      }
    }
  }
  for (const group of bundle.metricGroups) {
    if (!metricIds.has(group.leadMetricId)) {
      throw new Error(`Metric group ${group.id} has missing lead metric`);
    }
    for (const metricId of group.metricIds) {
      if (!metricIds.has(metricId)) {
        throw new Error(`Metric group ${group.id} has missing metric ${metricId}`);
      }
    }
  }
  for (const entry of bundle.groupingLedger?.entries || []) {
    if (entry.workGroupId && !workGroupIds.has(entry.workGroupId)) {
      throw new Error(`Grouping ledger ${entry.id} has missing WorkGroup`);
    }
    for (const entityId of [...entry.entityIds, ...entry.contextEntityIds]) {
      if (!entityIds.has(entityId)) {
        throw new Error(`Grouping ledger ${entry.id} has missing entity`);
      }
    }
    for (const itemId of entry.itemIds) {
      if (!itemIds.has(itemId)) {
        throw new Error(`Grouping ledger ${entry.id} has missing item`);
      }
    }
  }

  if (publicOnly) {
    if (bundle.items.some((item) => item.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public item");
    }
    if (bundle.entities.some((entity) => entity.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public entity");
    }
    if (bundle.workGroups.some((group) => group.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public WorkGroup");
    }
    if (bundle.metrics.some((metric) => metric.publicationState !== "public")) {
      throw new Error("Public bundle contains a non-public metric");
    }
    if (bundle.evidence.some((evidence) => evidence.access !== "public_web")) {
      throw new Error("Public bundle contains non-public evidence");
    }
    if (bundle.groupingLedger) {
      throw new Error("Public bundle contains owner-only grouping data");
    }
  }
}

export function assertPublicSafety(publicBundle, { blockedPublicText, approvedPublicDisplays }) {
  const combined = JSON.stringify(publicBundle).toLowerCase();
  for (const fragment of blockedPublicText) {
    if (combined.includes(fragment)) throw new Error(`Public data contains blocked text: ${fragment}`);
  }

  for (const metric of publicBundle.metrics) {
    for (const forbidden of ["value", "unit", "evidenceIds", "sourceRecord"]) {
      if (Object.hasOwn(metric, forbidden)) {
        throw new Error(`Public metric ${metric.id} exposes forbidden field ${forbidden}`);
      }
    }
    if (typeof metric.displayValue !== "string" || !approvedPublicDisplays.has(metric.displayValue)) {
      throw new Error(`Public metric ${metric.id} lacks approved display copy`);
    }
    if (metric.key.includes("tool_calls") && metric.displayValue.includes("$")) {
      throw new Error(`Public tool-call metric ${metric.id} uses currency formatting`);
    }
  }

  if (Object.hasOwn(publicBundle, "groupingLedger")) {
    throw new Error("Public bundle exposes owner-only curation");
  }

  for (const snapshot of publicBundle.sourceSnapshots) {
    if (Object.hasOwn(snapshot, "sha256") || Object.hasOwn(snapshot, "sourceFile")) {
      throw new Error(`Public snapshot ${snapshot.id} exposes private provenance`);
    }
  }

  const checkUrl = (url, context) => {
    if (url.startsWith("/")) return;
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${context} uses an unsafe URL protocol`);
    }
    const normalized = url.toLowerCase();
    if (blockedPublicText.some((fragment) => normalized.includes(fragment))) {
      throw new Error(`${context} uses a blocked URL`);
    }
  };

  for (const item of publicBundle.items) {
    for (const entry of item.urls) checkUrl(entry.url, `Item ${item.id}`);
  }
  for (const evidence of publicBundle.evidence) {
    if (evidence.url) checkUrl(evidence.url, `Evidence ${evidence.id}`);
  }
}
