/** Human-readable migration report, isolated from normalization and writes. */
export function buildQualityReport({
  contentVersion,
  footprintRows,
  impactRows,
  footprintSections,
  impactSections,
  ownerBundle,
  publicBundle,
}, {
  countBy,
  normalizedTitle,
  normalizeUrl,
  correctMlopsUrl,
  expectedFootprintRows,
  planBaselineImpactRows,
}) {
  const footprintCategories = [...countBy(footprintRows, (row) => row.category).entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const confidenceCounts = [...countBy(footprintRows, (row) => row.confidence).entries()].sort(
    (left, right) => right[1] - left[1],
  );
  const relationCounts = [...countBy(ownerBundle.relations, (relation) => relation.predicate).entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([predicate, count]) => `| ${predicate} | ${count} |`)
    .join("\n");
  const categoryRows = footprintCategories
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join("\n");
  const repeatedTitles = [...countBy(footprintRows, (row) => normalizedTitle(row.title)).values()].filter(
    (count) => count > 1,
  ).length;
  const urls = footprintRows.flatMap((row) => [row.primary_url, row.secondary_url].filter(Boolean));
  const repeatedUrls = [...countBy(urls, normalizeUrl).values()].filter((count) => count > 1).length;
  const durationSeconds = ownerBundle.items.reduce(
    (total, item) => total + (item.durationSeconds || 0),
    0,
  );
  const correctedUrls = ownerBundle.items
    .flatMap((item) => item.urls)
    .filter((entry) => entry.url === correctMlopsUrl).length;
  const privateMetricKeys = [
    ...new Set(
      impactRows
        .filter(
          (row) =>
            ![
              "public_event_references",
              "unique_recordings",
              "articles",
              "reports",
              "producer_credits",
              "translations",
            ].includes(row.metric),
        )
        .map((row) => row.metric),
    ),
  ].sort();
  const publicClaimIds = publicBundle.metrics.map((metric) => `- \`${metric.id}\``).join("\n");
  const ownerExactMetricCount = ownerBundle.metrics.filter((metric) =>
    Object.hasOwn(metric, "sourceRecord"),
  ).length;
  const reviewedMetricCount = impactRows.filter((row) => row.source_system === "owner_review").length;
  const legacyMetricCount = impactRows.length - reviewedMetricCount;
  const footprintItemCount = ownerBundle.items.filter(
    (item) => item.sourceRecord?.snapshotId === "snapshot:public-footprint-csv",
  ).length;
  const supplementalItemCount = ownerBundle.items.length - footprintItemCount;
  const entityCounts = [...countBy(ownerBundle.entities, (entity) => entity.kind).entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const workGroupCounts = [
    ...countBy(publicBundle.workGroups, (group) => group.bucket).entries(),
  ]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([bucket, count]) => `${bucket} ${count}`)
    .join(", ");
  const groupingDecisionCounts = [
    ...countBy(
      ownerBundle.groupingLedger.entries,
      (entry) => entry.decision,
    ).entries(),
  ]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([decision, count]) => `${decision} ${count}`)
    .join(", ");

  return `# Canonical content migration quality report

Generated from four immutable source files plus reviewed canonical and presentation curation. Content version: \`${contentVersion}\`.

## Source accounting

| Source | Plan baseline | Current parsed | Accounted |
|---|---:|---:|---:|
| Public footprint CSV | ${expectedFootprintRows} | ${footprintRows.length} | ${footprintItemCount} |
| Impact metrics CSV | ${planBaselineImpactRows} | ${legacyMetricCount} | ${legacyMetricCount} |
| Reviewed metric additions | — | ${reviewedMetricCount} | ${reviewedMetricCount} |
| Public footprint Markdown | — | ${footprintSections.length} level-two sections | ${footprintSections.length} owner narrative blocks |
| Impact report Markdown | — | ${impactSections.length} level-two sections | ${impactSections.length} owner narrative blocks |

The impact CSV has **${legacyMetricCount - planBaselineImpactRows} more rows** than the plan baseline. The importer preserves those immutable observations; separately reviewed aggregate additions do not rewrite the CSV.

The canonical bundle also contains **${supplementalItemCount} reviewed supplemental records** from the supplied Markdown and versioned portfolio updates. Owner-reviewed descriptions may have no public materials; they never expose private links or masquerade as public code. Original footprint observations are unchanged.

## Footprint inventory

| Category | Rows |
|---|---:|
${categoryRows}

- Confidence distribution: ${confidenceCounts.map(([label, count]) => `${label} ${count}`).join(", ")}.
- Repeated normalized titles: ${repeatedTitles}; repeated canonical URLs: ${repeatedUrls}.
- Recording duration represented: ${durationSeconds} seconds (${Math.floor(durationSeconds / 3600)}h ${Math.floor(
    (durationSeconds % 3600) / 60,
  )}m ${durationSeconds % 60}s).
- Known MLOps Community URL corrections applied: ${correctedUrls}.

## Relations

| Predicate | Generated |
|---|---:|
${relationCounts || "| none | 0 |"}

Recording relations require a unique best typed match across URL role, date, exact title, and organization. Reviewed curation supplies explicit corrections and relationships; title-only ties never write a relation.

## Canonical entities

- Entity groups: ${ownerBundle.entities.length} (${entityCounts}).
- Source observations keep stable opaque IDs and retain their legacy IDs and route aliases.
- Work, occurrence, artifact, and program groupings preserve every source item; representations and context records remain inspectable without inflating unique-work views.

## Public WorkGroups

- Public WorkGroups: ${publicBundle.workGroups.length} (${workGroupCounts}).
- Every public \`unique_work\` entity belongs to exactly one WorkGroup, including the reviewed EvalForge supplemental work.
- Explicit curation groups related courses, workshop editions, regional broadcasts, repeated talk deliveries, pull-request families, and production credits without changing canonical entity IDs or legacy routes.
- Remaining eligible entities receive deterministic standalone groups; context entities never become standalone WorkGroups.
- Owner-only grouping ledger decisions: ${groupingDecisionCounts}.
- Duplicate titles and URLs alone never create a grouping; the ledger requires explicit curation, typed relations, or deterministic standalone classification.

## Publication projection

- Owner bundle: ${ownerBundle.items.length} items (${footprintItemCount} footprint observations + ${supplementalItemCount} reviewed supplemental records), ${ownerExactMetricCount} exact metric observations plus ${publicBundle.metrics.length} reviewed public projections, ${ownerBundle.evidence.length} evidence records, and ${ownerBundle.narratives.length} source narrative blocks.
- Public bundle: ${publicBundle.items.length} public items, ${publicBundle.entities.length} canonical entities, ${publicBundle.workGroups.length} WorkGroups, ${publicBundle.metrics.length} rounded or derived public measures in ${publicBundle.metricGroups.length} presentation groups, ${publicBundle.evidence.length} public evidence records, and ${publicBundle.collections.length} collections.
- Legacy exact metric observations remain only in the ignored owner bundle. The versioned update input contains only owner-approved, public-safe aggregates.
- Dated active-claim replacements select the Home MCP checkpoint and cross-year program total without deleting older owner observations. October review dates are not invented measurement cutoffs.
- Public metrics contain display strings and qualifiers, never raw numeric value fields.
- Internal evidence URLs, source excerpts, local paths, and source hashes are excluded from public output.

Public measure records:

${publicClaimIds}

## Private or excluded metric families

The following source metric families remain exact only in the owner bundle unless represented by a separately reviewed rounded public claim:

${privateMetricKeys.map((key) => `- \`${key}\``).join("\n")}

Completion floors, paid-organization associations, aggregate course-campaign leads, failure or support telemetry, private projects, customer names, team allocations, and warehouse-only attribution views are not copied into public data.

## Verification checks

- Stable opaque source-observation IDs are unique across all ${ownerBundle.items.length} items; legacy IDs and old route slugs remain aliases.
- Every organization, entity, evidence, relation, collection, and metric subject reference resolves.
- Every WorkGroup member, context entity, item, organization, and metric presentation reference resolves.
- All ${footprintRows.length} footprint rows and ${impactRows.length} impact rows retain source-row fingerprints in the owner bundle.
- Tool-call display values are validated against currency prefixes.
- Item-detail metrics require an explicit item or canonical-entity subject; collection metrics are never inherited implicitly.
- The public projection contains only \`public\` publication states and \`public_web\` evidence.
- Public URLs pass protocol and blocked-domain checks.
- Re-running the importer with unchanged inputs produces byte-identical generated outputs.
`;
}
