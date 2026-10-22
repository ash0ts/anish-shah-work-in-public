/** Canonical entity, WorkGroup, grouping-ledger, and metric-presentation stages. */
import { countBy, normalizedTitle, normalizeUrl } from "./primitives.mjs";

export const PRESENTATION_SCHEMA_VERSION = "1.0";

export const TYPE_ORDER = [
  "course",
  "article",
  "technical_report",
  "open_source_repo",
  "open_source_pr",
  "event",
  "recording",
  "producer_credit",
  "external_reference",
  "translation",
  "mirror",
  "profile",
];

export const WORK_BUCKETS = new Set([
  "products-open-source",
  "courses-learning",
  "writing-research",
  "talks-programs",
]);

export const WORK_GROUPING_DECISIONS = new Set([
  "same_story",
  "same_occurrence_representation",
  "program_sibling",
  "standalone",
  "reference_only",
]);

export const METRIC_THEMES = new Set(["learning", "product", "programs", "archive"]);

export function itemByLegacyId(items, legacyId) {
  return items.find((item) => item.legacyIds.includes(legacyId));
}

export function buildCanonicalEntities(items, relations, curation) {
  const parent = new Map(items.map((item) => [item.id, item.id]));
  const find = (id) => {
    const current = parent.get(id);
    if (!current) throw new Error(`Unknown item while grouping: ${id}`);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (leftId, rightId) => {
    const left = find(leftId);
    const right = find(rightId);
    if (left === right) return;
    parent.set(right, left);
  };

  const groupingPredicates = new Set([
    "recording_of",
    "mirror_of",
    "translation_of",
    "part_of",
    "implements",
  ]);
  for (const relation of relations) {
    if (groupingPredicates.has(relation.predicate)) {
      union(relation.fromId, relation.toId);
    }
  }

  const resolveMembers = (definition) => [
    ...(definition.memberLegacyIds || []).map((legacyId) => {
      const item = itemByLegacyId(items, legacyId);
      if (!item) throw new Error(`Forced entity member is missing: ${legacyId}`);
      return item;
    }),
    ...(definition.memberItemIds || []).map((itemId) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error(`Forced entity member is missing: ${itemId}`);
      return item;
    }),
  ];

  for (const definition of curation.forcedEntities) {
    const members = resolveMembers(definition);
    for (const member of members.slice(1)) union(members[0].id, member.id);
  }

  const components = new Map();
  for (const item of items) {
    const root = find(item.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(item);
  }

  const primaryPriority = [
    "event",
    "course",
    "article",
    "technical_report",
    "open_source_repo",
    "producer_credit",
    "recording",
    "open_source_pr",
    "external_reference",
    "translation",
    "mirror",
    "profile",
  ];
  const entities = [];
  const componentEntityByItemId = new Map();

  const roleForItem = (item, primaryId) => {
    if (item.id === primaryId) return "primary";
    if (item.type === "recording") return "recording";
    if (item.type === "mirror") return "mirror";
    if (item.type === "translation") return "translation";
    if (item.type === "external_reference") return "reference";
    if (item.type === "profile") return "profile";
    const outgoing = relations.filter((relation) => relation.fromId === item.id);
    if (outgoing.some((relation) => relation.predicate === "implements")) return "implementation";
    if (outgoing.some((relation) => relation.predicate === "part_of")) return "component";
    return "component";
  };

  for (const memberItems of components.values()) {
    const memberIds = new Set(memberItems.map((item) => item.id));
    const forced = curation.forcedEntities.find((definition) =>
      resolveMembers(definition).some((item) => memberIds.has(item.id)),
    );
    const configuredPrimary =
      forced?.primaryLegacyId && itemByLegacyId(items, forced.primaryLegacyId);
    const primary =
      configuredPrimary ||
      [...memberItems].sort(
        (left, right) =>
          primaryPriority.indexOf(left.type) - primaryPriority.indexOf(right.type) ||
          (left.date.start || "").localeCompare(right.date.start || "") ||
          left.id.localeCompare(right.id),
      )[0];
    const kind =
      forced?.kind ||
      (memberItems.some((item) => item.type === "event" || item.type === "recording")
        ? "occurrence"
        : memberItems.some((item) =>
              ["course", "article", "technical_report", "open_source_repo", "producer_credit"].includes(
                item.type,
              ),
            )
          ? "work"
          : "artifact");
    const countability =
      forced?.countability ||
      (kind === "work" || kind === "occurrence"
        ? "unique_work"
        : memberItems.every((item) =>
              ["external_reference", "profile"].includes(item.type),
            )
          ? "context"
          : memberItems.every((item) => ["mirror", "translation"].includes(item.type))
            ? "representation"
            : "unique_work");
    const sourceSnapshots = new Set(
      memberItems.map((item) => item.sourceRecord?.snapshotId),
    );
    const sourceBasis =
      sourceSnapshots.size === 1 &&
      sourceSnapshots.has("snapshot:public-footprint-csv")
        ? "footprint"
        : sourceSnapshots.size === 1
          ? "supplemental"
          : "mixed";
    const prefix = kind === "work" ? "wk" : kind === "occurrence" ? "oc" : "ar";
    const id = forced?.id || `entity:${prefix}-${primary.id.replace(/^item:/, "")}`;
    const slug = forced?.slug || primary.slug;
    const practice =
      forced?.practice ||
      (memberItems.some((item) => item.type === "course")
        ? "teach"
        : memberItems.some((item) => item.type === "event" || item.type === "recording")
          ? "convene"
          : "build");
    const explicitDateItem = forced?.representativeItemId
      ? memberItems.find((item) => item.id === forced.representativeItemId)
      : null;
    if (forced?.representativeItemId && !explicitDateItem) {
      throw new Error(`Representative date item is not a member: ${forced.id}`);
    }
    const representativeItem =
      explicitDateItem || (primary.date.start
        ? primary
        : [...memberItems]
            .filter((item) => item.date.start)
            .sort(
              (left, right) =>
                (right.date.start || "").localeCompare(left.date.start || "") ||
                left.id.localeCompare(right.id),
            )[0] || primary);
    const itemIds = memberItems.map((item) => item.id).sort();
    const entity = {
      id,
      slug,
      slugAliases: [
        ...new Set(
          memberItems
            .flatMap((item) => [item.slug, ...item.slugAliases])
            .filter((alias) => alias !== slug),
        ),
      ].sort(),
      kind,
      title: primary.title,
      displayTitle: forced?.displayTitle || primary.displayTitle,
      shortTitle: forced?.shortTitle || primary.shortTitle,
      summary: forced?.summary || primary.summary || `${primary.role}.`,
      practice,
      representativeDate: representativeItem.date,
      year: representativeItem.year,
      role: primary.role,
      organizationIds: [...new Set(memberItems.flatMap((item) => item.organizationIds))].sort(),
      topics: [...new Set(memberItems.flatMap((item) => item.topics))].sort(),
      primaryItemId: primary.id,
      itemIds,
      parentEntityIds: [],
      countability,
      sourceBasis,
      childCounts: {
        items: itemIds.length,
        occurrences:
          memberItems.filter((item) => item.type === "event").length ||
          (memberItems.some((item) => item.type === "recording") ? 1 : 0),
        artifacts: memberItems.filter(
          (item) => !["event", "course", "article", "technical_report"].includes(item.type),
        ).length,
      },
      publicationState: "public",
      verificationState: primary.verificationState,
    };
    entities.push(entity);
    for (const item of memberItems) {
      item.canonicalEntityId = entity.id;
      item.entityRole = roleForItem(item, primary.id);
      componentEntityByItemId.set(item.id, entity);
    }
  }

  for (const program of curation.programs) {
    const members = [
      ...(program.memberLegacyIds || []).map((legacyId) => {
        const item = itemByLegacyId(items, legacyId);
        if (!item) throw new Error(`Program member is missing: ${legacyId}`);
        return item;
      }),
      ...items.filter(
        (item) =>
          program.memberFilter &&
          (!program.memberFilter.type || item.type === program.memberFilter.type) &&
          (!program.memberFilter.year || item.year === program.memberFilter.year),
      ),
    ];
    const uniqueMembers = [...new Map(members.map((item) => [item.id, item])).values()];
    const childEntities = [
      ...new Map(
        uniqueMembers.map((item) => [
          componentEntityByItemId.get(item.id).id,
          componentEntityByItemId.get(item.id),
        ]),
      ).values(),
    ];
    for (const child of childEntities) child.parentEntityIds.push(program.id);
    const primary = uniqueMembers[0] || null;
    const organizationIds = [
      ...new Set(uniqueMembers.flatMap((item) => item.organizationIds)),
    ].sort();
    const topics = [...new Set(uniqueMembers.flatMap((item) => item.topics))].sort();
    const programSourceSnapshots = new Set(
      uniqueMembers.map((item) => item.sourceRecord?.snapshotId),
    );
    const sourceBasis =
      uniqueMembers.length === 0
        ? "synthetic"
        : programSourceSnapshots.size === 1 &&
            programSourceSnapshots.has("snapshot:public-footprint-csv")
          ? "footprint"
          : programSourceSnapshots.size === 1
            ? "supplemental"
            : "mixed";
    entities.push({
      id: program.id,
      slug: program.slug,
      slugAliases: [],
      kind: "program",
      title: program.displayTitle,
      displayTitle: program.displayTitle,
      shortTitle: program.shortTitle,
      summary: program.summary,
      practice: program.practice,
      representativeDate: primary?.date || {
        start: program.year ? String(program.year) : null,
        end: null,
        precision: program.year ? "year" : "unknown",
        basis: program.year ? "event_date" : "unknown",
      },
      year: program.year || primary?.year || program.memberFilter?.year || null,
      role: "Program context",
      organizationIds,
      topics,
      primaryItemId: primary?.id || null,
      itemIds: uniqueMembers.map((item) => item.id).sort(),
      parentEntityIds: [],
      countability: "context",
      sourceBasis,
      childCounts: {
        items: uniqueMembers.length,
        occurrences: childEntities.filter((entity) => entity.kind === "occurrence").length,
        artifacts: childEntities.filter((entity) => entity.kind === "artifact").length,
      },
      publicationState: "public",
      verificationState: uniqueMembers.length ? "corroborated" : "tentative",
    });
  }

  for (const entity of entities) {
    entity.parentEntityIds = [...new Set(entity.parentEntityIds)].sort();
  }
  const slugs = countBy(entities, (entity) => entity.slug);
  for (const entity of entities) {
    if (slugs.get(entity.slug) !== 1) {
      throw new Error(`Curation produced duplicate entity slug: ${entity.slug}`);
    }
  }
  return entities.sort((left, right) => left.id.localeCompare(right.id));
}

function workBucketForEntity(entity, itemById) {
  const primary = entity.primaryItemId ? itemById.get(entity.primaryItemId) : null;
  if (primary?.type === "course") return "courses-learning";
  if (
    entity.kind === "occurrence" ||
    ["event", "recording", "producer_credit"].includes(primary?.type)
  ) {
    return "talks-programs";
  }
  if (["article", "technical_report", "translation"].includes(primary?.type)) {
    return "writing-research";
  }
  return "products-open-source";
}

function workGroupPeriod(memberEntities) {
  const dates = memberEntities.map((entity) => entity.representativeDate);
  const starts = dates.map((date) => date.start).filter(Boolean).sort();
  const ends = dates
    .map((date) => date.end || date.start)
    .filter(Boolean)
    .sort();
  const start = starts[0] || null;
  const last = ends.at(-1) || null;
  const end = start && last && start !== last ? last : null;
  const precisions = [...new Set(dates.map((date) => date.precision))];
  const bases = [...new Set(dates.map((date) => date.basis))];
  return {
    start,
    end,
    precision: precisions.length === 1 ? precisions[0] : "unknown",
    basis: bases.length === 1 ? bases[0] : "unknown",
  };
}

export function buildWorkGroups(items, entities, manifest) {
  if (manifest.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
    throw new Error(`Work-group curation schema must be ${PRESENTATION_SCHEMA_VERSION}`);
  }
  const bucketIds = new Set(manifest.buckets.map((bucket) => bucket.id));
  if (
    bucketIds.size !== WORK_BUCKETS.size ||
    [...WORK_BUCKETS].some((bucket) => !bucketIds.has(bucket))
  ) {
    throw new Error("Work-group curation must define the four approved buckets exactly once");
  }
  const bucketOrder = new Map(
    manifest.buckets.map((bucket) => [bucket.id, bucket.order]),
  );
  const itemById = new Map(items.map((item) => [item.id, item]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const claimedEligibleIds = new Set();
  const claimedExplicitIds = new Set();
  const explicitById = new Map();

  for (const definition of manifest.groups) {
    if (!WORK_BUCKETS.has(definition.bucket)) {
      throw new Error(`Work group ${definition.id} uses an unknown bucket`);
    }
    if (!WORK_GROUPING_DECISIONS.has(definition.decision)) {
      throw new Error(`Work group ${definition.id} uses an unknown grouping decision`);
    }
    if (!definition.roleSummary?.trim()) {
      throw new Error(`Work group ${definition.id} lacks a curated role summary`);
    }
    if (!definition.memberEntityIds.includes(definition.primaryEntityId)) {
      throw new Error(`Work group ${definition.id} does not contain its primary entity`);
    }
    for (const entityId of [
      ...definition.memberEntityIds,
      ...definition.contextEntityIds,
    ]) {
      if (!entityById.has(entityId)) {
        throw new Error(`Work group ${definition.id} has missing entity ${entityId}`);
      }
    }
    for (const entityId of definition.memberEntityIds) {
      if (claimedExplicitIds.has(entityId)) {
        throw new Error(`Entity ${entityId} appears in more than one explicit work group`);
      }
      claimedExplicitIds.add(entityId);
      if (entityById.get(entityId).countability === "unique_work") {
        claimedEligibleIds.add(entityId);
      }
    }
    explicitById.set(definition.id, definition);
  }

  const contextByEntityId = new Map();
  for (const decision of manifest.contextDecisions) {
    if (!WORK_GROUPING_DECISIONS.has(decision.decision)) {
      throw new Error(`Context decision ${decision.id} uses an unknown decision`);
    }
    for (const entityId of [...decision.entityIds, ...decision.contextEntityIds]) {
      if (!entityById.has(entityId)) {
        throw new Error(`Context decision ${decision.id} has missing entity ${entityId}`);
      }
    }
    for (const entityId of decision.entityIds) {
      const current = contextByEntityId.get(entityId) || [];
      current.push(...decision.contextEntityIds);
      contextByEntityId.set(entityId, current);
    }
  }

  const definitions = [
    ...manifest.groups,
    ...entities
      .filter(
        (entity) =>
          entity.publicationState === "public" &&
          entity.countability === "unique_work" &&
          !claimedEligibleIds.has(entity.id),
      )
      .map((entity) => ({
        id: `group:standalone:${entity.id.replace(/^entity:/, "")}`,
        slug: entity.slug,
        title: entity.displayTitle,
        shortTitle: entity.shortTitle,
        summary: entity.summary,
        roleSummary: entity.role,
        bucket: workBucketForEntity(entity, itemById),
        featuredOrder: null,
        primaryEntityId: entity.id,
        memberEntityIds: [entity.id],
        contextEntityIds: [],
        decision: "standalone",
        rationale: "No reviewed evidence supports merging this entity with another work.",
      })),
  ];

  const groups = definitions.map((definition) => {
    const memberEntities = definition.memberEntityIds.map((id) => entityById.get(id));
    const itemIds = [
      ...new Set(memberEntities.flatMap((entity) => entity.itemIds)),
    ].sort();
    const memberItems = itemIds.map((id) => itemById.get(id));
    const period = workGroupPeriod(memberEntities);
    const parentContexts = memberEntities.flatMap((entity) => entity.parentEntityIds);
    const decisionContexts = memberEntities.flatMap(
      (entity) => contextByEntityId.get(entity.id) || [],
    );
    const relatedContextEntityIds = [
      ...new Set([
        ...definition.contextEntityIds,
        ...parentContexts,
        ...decisionContexts,
      ]),
    ]
      .filter((id) => !definition.memberEntityIds.includes(id))
      .sort();
    const programEntityIds = relatedContextEntityIds.filter(
      (id) => entityById.get(id).kind === "program",
    );
    const contextEntityIds = relatedContextEntityIds.filter(
      (id) => entityById.get(id).kind !== "program",
    );
    const years = [period.start, period.end || period.start]
      .filter(Boolean)
      .map((value) => Number(value.slice(0, 4)))
      .filter(Number.isFinite);
    const verificationState = memberEntities.some(
      (entity) => entity.verificationState === "tentative",
    )
      ? "tentative"
      : memberEntities.every((entity) => entity.verificationState === "verified")
        ? "verified"
        : "corroborated";
    return {
      id: definition.id,
      slug: definition.slug,
      slugAliases: [
        ...new Set(
          memberEntities
            .flatMap((entity) => [entity.slug, ...entity.slugAliases])
            .filter((slug) => slug !== definition.slug),
        ),
      ].sort(),
      title: definition.title,
      shortTitle: definition.shortTitle,
      summary: definition.summary,
      roleSummary: definition.roleSummary,
      bucket: definition.bucket,
      featuredOrder: definition.featuredOrder,
      primaryEntityId: definition.primaryEntityId,
      memberEntityIds: [...new Set(definition.memberEntityIds)].sort(),
      programEntityIds,
      contextEntityIds,
      itemIds,
      period,
      yearStart: years.length ? Math.min(...years) : null,
      yearEnd: years.length ? Math.max(...years) : null,
      organizationIds: [
        ...new Set(memberEntities.flatMap((entity) => entity.organizationIds)),
      ].sort(),
      topics: [...new Set(memberEntities.flatMap((entity) => entity.topics))].sort(),
      formats: [...new Set(memberItems.map((item) => item.type))].sort(
        (left, right) => TYPE_ORDER.indexOf(left) - TYPE_ORDER.indexOf(right),
      ),
      publicationState: "public",
      verificationState,
    };
  });

  const eligibleIds = entities
    .filter(
      (entity) =>
        entity.publicationState === "public" &&
        entity.countability === "unique_work",
    )
    .map((entity) => entity.id);
  const memberCounts = countBy(
    groups.flatMap((group) => group.memberEntityIds),
    (id) => id,
  );
  for (const entityId of eligibleIds) {
    if (memberCounts.get(entityId) !== 1) {
      throw new Error(
        `Eligible entity ${entityId} must belong to exactly one WorkGroup`,
      );
    }
  }
  const groupSlugs = countBy(groups, (group) => group.slug);
  for (const group of groups) {
    if (groupSlugs.get(group.slug) !== 1) {
      throw new Error(`Duplicate WorkGroup slug: ${group.slug}`);
    }
  }
  for (const bucket of WORK_BUCKETS) {
    const featured = groups
      .filter((group) => group.bucket === bucket && group.featuredOrder !== null)
      .map((group) => group.featuredOrder)
      .sort((left, right) => left - right);
    if (featured.join(",") !== "1,2,3") {
      throw new Error(`WorkGroup bucket ${bucket} must have featured order 1,2,3`);
    }
  }

  return groups.sort(
    (left, right) =>
      bucketOrder.get(left.bucket) - bucketOrder.get(right.bucket) ||
      (left.featuredOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.featuredOrder ?? Number.MAX_SAFE_INTEGER) ||
      (right.period.start || "").localeCompare(left.period.start || "") ||
      left.title.localeCompare(right.title),
  );
}

export function buildGroupingLedger(
  items,
  entities,
  workGroups,
  manifest,
  footprintRows,
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const groupByEntityId = new Map(
    workGroups.flatMap((group) =>
      group.memberEntityIds.map((entityId) => [entityId, group]),
    ),
  );
  const definitionById = new Map(
    manifest.groups.map((definition) => [definition.id, definition]),
  );
  const entries = workGroups.map((group) => {
    const definition = definitionById.get(group.id);
    return {
      id: `ledger:work-group:${group.id.replace(/^group:/, "").replaceAll(":", "-")}`,
      workGroupId: group.id,
      decision: definition?.decision || "standalone",
      rule: definition ? "explicit_curation" : "deterministic_standalone",
      entityIds: group.memberEntityIds,
      contextEntityIds: [
        ...new Set([...group.programEntityIds, ...group.contextEntityIds]),
      ].sort(),
      itemIds: group.itemIds,
      rationale:
        definition?.rationale ||
        "No reviewed relation or curation override supports a broader grouping.",
    };
  });

  for (const entity of entities) {
    const memberItems = entity.itemIds.map((id) => itemById.get(id));
    if (
      memberItems.length < 2 ||
      !memberItems.some((item) =>
        ["recording", "mirror", "translation"].includes(item.entityRole),
      )
    ) {
      continue;
    }
    entries.push({
      id: `ledger:representation:${entity.id.replace(/^entity:/, "")}`,
      workGroupId: groupByEntityId.get(entity.id)?.id || null,
      decision: "same_occurrence_representation",
      rule: "typed_relation",
      entityIds: [entity.id],
      contextEntityIds: [],
      itemIds: entity.itemIds,
      rationale:
        "Typed recording, mirror, or translation relations preserve distinct public forms under one canonical entity.",
    });
  }

  for (const decision of manifest.contextDecisions) {
    const targetGroups = [
      ...new Set(
        decision.entityIds
          .map((entityId) => groupByEntityId.get(entityId)?.id)
          .filter(Boolean),
      ),
    ];
    entries.push({
      id: decision.id,
      workGroupId: targetGroups.length === 1 ? targetGroups[0] : null,
      decision: decision.decision,
      rule: "explicit_curation",
      entityIds: [...decision.entityIds].sort(),
      contextEntityIds: [...decision.contextEntityIds].sort(),
      itemIds: [
        ...new Set(
          [...decision.entityIds, ...decision.contextEntityIds].flatMap(
            (entityId) => entityById.get(entityId).itemIds,
          ),
        ),
      ].sort(),
      rationale: decision.rationale,
    });
  }

  const classifiedContextIds = new Set(
    entries.flatMap((entry) => entry.contextEntityIds),
  );
  const memberEntityIds = new Set(
    workGroups.flatMap((group) => group.memberEntityIds),
  );
  for (const entity of entities) {
    if (memberEntityIds.has(entity.id) || classifiedContextIds.has(entity.id)) {
      continue;
    }
    entries.push({
      id: `ledger:context:${entity.id.replace(/^entity:/, "")}`,
      workGroupId: null,
      decision: "reference_only",
      rule: "context_classification",
      entityIds: [entity.id],
      contextEntityIds: [],
      itemIds: entity.itemIds,
      rationale:
        "This entity is retained as program, profile, citation, or representation context and is not a standalone public work.",
    });
  }

  const repeatedTitleClusterCount = [
    ...countBy(footprintRows, (row) => normalizedTitle(row.title)).values(),
  ].filter((count) => count > 1).length;
  const urls = footprintRows.flatMap((row) =>
    [row.primary_url, row.secondary_url].filter(Boolean),
  );
  const repeatedUrlClusterCount = [
    ...countBy(urls, normalizeUrl).values(),
  ].filter((count) => count > 1).length;
  return {
    schemaVersion: "1.0",
    repeatedTitleClusterCount,
    repeatedUrlClusterCount,
    entries: entries.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function buildMetricGroups(publicMetrics, presentation) {
  if (presentation.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
    throw new Error(`Metric presentation schema must be ${PRESENTATION_SCHEMA_VERSION}`);
  }
  const metricIds = new Set(publicMetrics.map((metric) => metric.id));
  const groups = presentation.groups.map((definition) => {
    if (!METRIC_THEMES.has(definition.theme)) {
      throw new Error(`Metric group ${definition.id} uses an unknown theme`);
    }
    for (const metricId of definition.metricIds) {
      if (!metricIds.has(metricId)) {
        throw new Error(`Metric group ${definition.id} has missing metric ${metricId}`);
      }
    }
    if (!metricIds.has(definition.leadMetricId)) {
      throw new Error(`Metric group ${definition.id} has missing lead metric`);
    }
    return {
      ...definition,
      metricIds: [...definition.metricIds],
    };
  });
  const orders = groups.map((group) => group.order);
  if (new Set(orders).size !== groups.length) {
    throw new Error("Metric presentation group order must be unique");
  }
  return groups.sort((left, right) => left.order - right.order);
}
