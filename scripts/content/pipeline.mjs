import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../lib/csv.mjs";
import { buildJsonSchema } from "./schema.mjs";
import {
  assertUniqueItemSlugs,
  buildOrganizations,
  buildPublicEvidence,
  buildRelations,
  makePortfolioItems,
  makeSupplementalItems,
} from "./inventory.mjs";
import {
  CORRECT_MLOPS_URL,
  countBy,
  normalizeUrl,
  normalizedTitle,
  sha256,
  shortHash,
} from "./primitives.mjs";
import {
  buildCanonicalEntities,
  buildGroupingLedger,
  buildMetricGroups,
  buildWorkGroups,
} from "./grouping.mjs";
import {
  APPROVED_PUBLIC_DISPLAYS,
  buildOwnerMetrics,
  buildPublicMetrics,
  normalizeRecordedDate,
  parseMarkdownSections,
} from "./metrics.mjs";
import {
  buildCollections,
  buildProfile,
  buildPublicNarratives,
  markFeatured,
  sourceSnapshot,
  stripPrivateItemFields,
} from "./presentation.mjs";
import { buildQualityReport } from "./report.mjs";
import { writeOrCheck } from "./write-output.mjs";
import { assertBundleIntegrity, assertPublicSafety } from "./validation.mjs";
import { applyPortfolioUpdates } from "./updates.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = path.resolve(PROJECT_ROOT, "..");

const SOURCE_FILES = {
  footprintCsv: path.join(SOURCE_ROOT, "anish_shah_public_footprint_2021-2026.csv"),
  footprintMarkdown: path.join(SOURCE_ROOT, "anish_shah_public_footprint_2021-2026.md"),
  impactCsv: path.join(SOURCE_ROOT, "anish_shah_impact_metrics_2021-2026.csv"),
  impactMarkdown: path.join(SOURCE_ROOT, "anish_shah_impact_report_2021-2026.md"),
  curation: path.join(PROJECT_ROOT, "content/curation/content-v1.1.json"),
  workGroups: path.join(PROJECT_ROOT, "content/curation/work-groups.v1.json"),
  portfolioUpdates: path.join(PROJECT_ROOT, "content/curation/portfolio-updates.v1.json"),
  metricGroups: path.join(PROJECT_ROOT, "content/presentation/metric-groups.v1.json"),
  claimUpgrades: path.join(
    PROJECT_ROOT,
    "content/curation/public-claim-upgrades.v1.json",
  ),
};

const OUTPUT_FILES = {
  owner: path.join(PROJECT_ROOT, "content/private/anish-content.v1.json"),
  public: path.join(PROJECT_ROOT, "content/public/anish-content.public.v1.json"),
  schema: path.join(PROJECT_ROOT, "content/schema/anish-content.schema.json"),
  report: path.join(PROJECT_ROOT, "content/reports/migration-quality.md"),
};

const EXPECTED_FOOTPRINT_ROWS = 184;
const EXPECTED_IMPACT_ROWS = 85;
const PLAN_BASELINE_IMPACT_ROWS = 61;
const SCHEMA_VERSION = "1.2";
const CURATION_SCHEMA_VERSION = "1.1";

const BLOCKED_PUBLIC_TEXT = [
  "app.notion.com",
  "notion.so",
  "app.hex.tech",
  "coreweave.enterprise.slack.com",
  "slack.com/archives",
  "/users/",
  "documents/new project",
];






export async function buildContent({ check = false } = {}) {
  const [
    footprintCsv,
    footprintMarkdown,
    impactCsv,
    impactMarkdown,
    curationSource,
    workGroupSource,
    metricGroupSource,
    claimUpgradeSource,
    updateSource,
  ] = await Promise.all([
    readFile(SOURCE_FILES.footprintCsv, "utf8"),
    readFile(SOURCE_FILES.footprintMarkdown, "utf8"),
    readFile(SOURCE_FILES.impactCsv, "utf8"),
    readFile(SOURCE_FILES.impactMarkdown, "utf8"),
    readFile(SOURCE_FILES.curation, "utf8"),
    readFile(SOURCE_FILES.workGroups, "utf8"),
    readFile(SOURCE_FILES.metricGroups, "utf8"),
    readFile(SOURCE_FILES.claimUpgrades, "utf8"),
    readFile(SOURCE_FILES.portfolioUpdates, "utf8"),
  ]);
  const updates = JSON.parse(updateSource);
  const { curation, workGroups: workGroupCuration } = applyPortfolioUpdates(
    JSON.parse(curationSource), JSON.parse(workGroupSource), updates,
  );
  const metricGroupPresentation = JSON.parse(metricGroupSource);
  const claimUpgrades = JSON.parse(claimUpgradeSource);
  if (curation.schemaVersion !== CURATION_SCHEMA_VERSION) {
    throw new Error(`Canonical curation schema must be ${CURATION_SCHEMA_VERSION}`);
  }
  const footprintRows = parseCsv(footprintCsv, path.basename(SOURCE_FILES.footprintCsv));
  const historicalImpactRows = parseCsv(impactCsv, path.basename(SOURCE_FILES.impactCsv));
  if (footprintRows.length !== EXPECTED_FOOTPRINT_ROWS) {
    throw new Error(
      `Footprint row count changed: expected ${EXPECTED_FOOTPRINT_ROWS}, found ${footprintRows.length}`,
    );
  }
  if (historicalImpactRows.length !== EXPECTED_IMPACT_ROWS) {
    throw new Error(
      `Impact row count changed: expected ${EXPECTED_IMPACT_ROWS}, found ${historicalImpactRows.length}`,
    );
  }

  const impactRows = [...historicalImpactRows, ...updates.metricObservations];
  const recordedDates = historicalImpactRows
    .map((row) => normalizeRecordedDate(row.date_recorded))
    .filter(Boolean)
    .sort();
  const legacyAsOf = recordedDates.at(-1);
  const asOf = [legacyAsOf, updates.reviewedAt].sort().at(-1);
  const generatedAt = `${asOf}T00:00:00.000Z`;
  const sourceContents = [
    footprintCsv,
    footprintMarkdown,
    impactCsv,
    impactMarkdown,
    curationSource,
    workGroupSource,
    metricGroupSource,
    claimUpgradeSource,
    updateSource,
  ];
  const generatorFiles = (
    await readdir(path.join(PROJECT_ROOT, "scripts/content"), {
      recursive: true,
    })
  )
    .filter((file) => file.endsWith(".mjs"))
    .sort();
  const generatorSources = await Promise.all(
    generatorFiles.map((file) =>
      readFile(path.join(PROJECT_ROOT, "scripts/content", file), "utf8"),
    ),
  );
  const csvParserSource = await readFile(
    path.join(PROJECT_ROOT, "scripts/lib/csv.mjs"),
    "utf8",
  );
  const generatorEntrypointSource = await readFile(
    path.join(PROJECT_ROOT, "scripts/build-content.mjs"),
    "utf8",
  );
  const contentVersion = shortHash(
    [
      ...sourceContents,
      generatorEntrypointSource,
      ...generatorSources,
      csvParserSource,
    ]
      .map((content) => sha256(content))
      .join(":"),
  );

  const ownerItems = [
    ...makePortfolioItems(footprintRows, curation),
    ...makeSupplementalItems(curation),
  ];
  assertUniqueItemSlugs(ownerItems);
  const publicEvidence = buildPublicEvidence(ownerItems, legacyAsOf, curation.supplementalItems);
  const organizations = buildOrganizations(footprintRows, curation);
  const relations = buildRelations(ownerItems, curation);
  const entities = buildCanonicalEntities(ownerItems, relations, curation);
  const ownerEvidence = structuredClone(publicEvidence);
  const ownerMetrics = buildOwnerMetrics(
    impactRows,
    ownerItems,
    entities,
    curation,
    ownerEvidence,
    asOf,
  );
  const footprintSections = parseMarkdownSections(
    footprintMarkdown,
    "public-footprint",
    "review_required",
  );
  const impactSections = parseMarkdownSections(impactMarkdown, "impact-report", "private");
  const ownerNarratives = [...footprintSections, ...impactSections];
  const publicMetrics = buildPublicMetrics(
    impactRows,
    ownerItems,
    entities,
    claimUpgrades,
  );
  const collections = buildCollections(ownerItems, publicMetrics);
  const workGroups = buildWorkGroups(ownerItems, entities, workGroupCuration);
  const groupingLedger = buildGroupingLedger(
    ownerItems,
    entities,
    workGroups,
    workGroupCuration,
    footprintRows,
  );
  const metricGroups = buildMetricGroups(publicMetrics, metricGroupPresentation);
  const selected = collections.find((collection) => collection.id === "collection:selected-work");
  markFeatured(ownerItems, selected);

  const ownerSnapshots = [
    sourceSnapshot({
      id: "snapshot:portfolio-updates-v1",
      label: "Reviewed portfolio updates",
      content: updateSource,
      capturedAt: updates.reviewedAt,
      rowCount: updates.items.length + updates.metricObservations.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.portfolioUpdates),
    }),
    sourceSnapshot({
      id: "snapshot:public-footprint-csv",
      label: "Public footprint inventory",
      content: footprintCsv,
      capturedAt: legacyAsOf,
      rowCount: footprintRows.length,
      access: "public_web",
      sourceFile: path.basename(SOURCE_FILES.footprintCsv),
    }),
    sourceSnapshot({
      id: "snapshot:public-footprint-markdown",
      label: "Public footprint research report",
      content: footprintMarkdown,
      capturedAt: legacyAsOf,
      sectionCount: footprintSections.length,
      access: "public_web",
      sourceFile: path.basename(SOURCE_FILES.footprintMarkdown),
    }),
    sourceSnapshot({
      id: "snapshot:impact-csv",
      label: "Owner impact metric ledger",
      content: impactCsv,
      capturedAt: legacyAsOf,
      rowCount: historicalImpactRows.length,
      access: "owner_private",
      sourceFile: path.basename(SOURCE_FILES.impactCsv),
    }),
    sourceSnapshot({
      id: "snapshot:impact-report-markdown",
      label: "Owner impact research report",
      content: impactMarkdown,
      capturedAt: legacyAsOf,
      sectionCount: impactSections.length,
      access: "owner_private",
      sourceFile: path.basename(SOURCE_FILES.impactMarkdown),
    }),
    sourceSnapshot({
      id: "snapshot:curation-v1.1",
      label: "Reviewed canonical curation",
      content: curationSource,
      capturedAt: asOf,
      rowCount: null,
      sectionCount: null,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.curation),
    }),
    sourceSnapshot({
      id: "snapshot:work-groups-v1",
      label: "Reviewed WorkGroup curation",
      content: workGroupSource,
      capturedAt: asOf,
      rowCount: workGroupCuration.groups.length,
      sectionCount: workGroupCuration.contextDecisions.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.workGroups),
    }),
    sourceSnapshot({
      id: "snapshot:metric-groups-v1",
      label: "Public metric presentation groups",
      content: metricGroupSource,
      capturedAt: asOf,
      rowCount: metricGroupPresentation.groups.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.metricGroups),
    }),
    sourceSnapshot({
      id: "snapshot:public-claim-upgrades-v1",
      label: "Selected public measure revisions",
      content: claimUpgradeSource,
      capturedAt: asOf,
      rowCount: claimUpgrades.claims.length,
      access: "owner_private",
      sourceFile: path.relative(PROJECT_ROOT, SOURCE_FILES.claimUpgrades),
    }),
  ];

  const profile = buildProfile(ownerItems);
  const sourceSummary = {
    footprintRows: footprintRows.length,
    impactRows: impactRows.length,
    supplementalArtifacts: curation.supplementalItems.length,
    publicItems: ownerItems.length,
    approvedMetricCount: publicMetrics.length,
    footprintBackedUniqueWorks: entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        (entity.sourceBasis === "footprint" || entity.sourceBasis === "mixed"),
    ).length,
    supplementalUniqueWorks: entities.filter(
      (entity) =>
        entity.countability === "unique_work" &&
        entity.sourceBasis === "supplemental",
    ).length,
  };
  const ownerBundle = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    sourceSummary,
    profile,
    organizations,
    items: ownerItems,
    entities,
    workGroups,
    metrics: [...ownerMetrics, ...publicMetrics],
    metricGroups,
    evidence: ownerEvidence,
    relations,
    collections,
    narratives: ownerNarratives,
    sourceSnapshots: ownerSnapshots,
    groupingLedger,
  };

  const publicBundle = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion,
    generatedAt,
    sourceSummary,
    profile,
    organizations,
    items: ownerItems.map(stripPrivateItemFields),
    entities,
    workGroups,
    metrics: publicMetrics,
    metricGroups,
    evidence: publicEvidence,
    relations,
    collections,
    narratives: buildPublicNarratives(),
    sourceSnapshots: [
      {
        id: "snapshot:public-footprint-inventory",
        label: "Public footprint inventory",
        capturedAt: legacyAsOf,
        rowCount: footprintRows.length,
        sectionCount: footprintSections.length,
        access: "public_web",
      },
      {
        id: "snapshot:public-portfolio-review",
        label: "Reviewed portfolio additions",
        capturedAt: updates.reviewedAt,
        rowCount: updates.items.length,
        sectionCount: null,
        access: "public_web",
      },
      {
        id: "snapshot:public-claims-review",
        label: "Rounded impact claim review",
        capturedAt: asOf,
        rowCount: publicMetrics.length,
        sectionCount: null,
        access: "public_web",
      },
    ],
  };
  const schema = buildJsonSchema();

  const integrityPolicy = {
    countBy,
    expectedFootprintRows: EXPECTED_FOOTPRINT_ROWS,
    expectedImpactRows: impactRows.length,
    approvedMetricCount: publicMetrics.length,
  };
  assertBundleIntegrity(ownerBundle, integrityPolicy);
  assertBundleIntegrity(publicBundle, {
    ...integrityPolicy,
    publicOnly: true,
  });
  assertPublicSafety(publicBundle, {
    blockedPublicText: BLOCKED_PUBLIC_TEXT,
    approvedPublicDisplays: APPROVED_PUBLIC_DISPLAYS,
  });

  const report = buildQualityReport(
    {
      contentVersion,
      footprintRows,
      impactRows,
      footprintSections,
      impactSections,
      ownerBundle,
      publicBundle,
    },
    {
      countBy,
      normalizedTitle,
      normalizeUrl,
      correctMlopsUrl: CORRECT_MLOPS_URL,
      expectedFootprintRows: EXPECTED_FOOTPRINT_ROWS,
      planBaselineImpactRows: PLAN_BASELINE_IMPACT_ROWS,
    },
  );
  const outputs = new Map([
    [OUTPUT_FILES.owner, `${JSON.stringify(ownerBundle, null, 2)}\n`],
    [OUTPUT_FILES.public, `${JSON.stringify(publicBundle, null, 2)}\n`],
    [OUTPUT_FILES.schema, `${JSON.stringify(schema, null, 2)}\n`],
    [OUTPUT_FILES.report, report],
  ]);
  await writeOrCheck(outputs, check, PROJECT_ROOT);

  return {
    contentVersion,
    footprintRows: footprintRows.length,
    impactRows: impactRows.length,
    publicItems: publicBundle.items.length,
    publicMetrics: publicBundle.metrics.length,
    relations: publicBundle.relations.length,
    checked: check,
  };
}
