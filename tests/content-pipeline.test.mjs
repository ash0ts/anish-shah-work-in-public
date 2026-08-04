import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../scripts/lib/csv.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = path.resolve(PROJECT_ROOT, "..");
const PUBLIC_PATH = path.join(
  PROJECT_ROOT,
  "content/public/anish-content.public.v1.json",
);
const OWNER_PATH = path.join(PROJECT_ROOT, "content/private/anish-content.v1.json");
const SCHEMA_PATH = path.join(PROJECT_ROOT, "content/schema/anish-content.schema.json");
const FOOTPRINT_PATH = path.join(
  SOURCE_ROOT,
  "anish_shah_public_footprint_2021-2026.csv",
);
const IMPACT_PATH = path.join(SOURCE_ROOT, "anish_shah_impact_metrics_2021-2026.csv");

const publicBundle = JSON.parse(readFileSync(PUBLIC_PATH, "utf8"));

test("safe CSV parser handles quotes, escaped quotes, CRLF, and multiline fields", () => {
  const input =
    '"name","note","count"\r\n"A","line one\nline two","1"\r\n"B","said ""hello""","2"\r\n';
  assert.deepEqual(parseCsv(input, "fixture.csv"), [
    { name: "A", note: "line one\nline two", count: "1" },
    { name: "B", note: 'said "hello"', count: "2" },
  ]);
  assert.throws(
    () => parseCsv('"a","b"\n"broken","field"x\n', "broken.csv"),
    /unexpected character after closing quote/,
  );
  assert.throws(() => parseCsv('"a","b"\n"broken\n', "broken.csv"), /unterminated quoted field/);
});

test(
  "current immutable CSV inputs account for every source record",
  { skip: !existsSync(FOOTPRINT_PATH) || !existsSync(IMPACT_PATH) },
  () => {
    const footprint = parseCsv(readFileSync(FOOTPRINT_PATH, "utf8"), path.basename(FOOTPRINT_PATH));
    const impact = parseCsv(readFileSync(IMPACT_PATH, "utf8"), path.basename(IMPACT_PATH));
    assert.equal(footprint.length, 184);
    assert.equal(impact.length, 85);
  },
);

test("public bundle preserves the complete footprint inventory", () => {
  assert.equal(publicBundle.schemaVersion, "1.2");
  assert.match(publicBundle.contentVersion, /^[a-f0-9]{16}$/);
  assert.deepEqual(publicBundle.sourceSummary, {
    footprintRows: 184,
    impactRows: 85,
    supplementalArtifacts: 2,
    publicItems: 186,
    approvedMetricCount: 13,
    footprintBackedUniqueWorks: 99,
    supplementalUniqueWorks: 1,
  });
  assert.equal(publicBundle.items.length, 186);
  assert.equal(
    publicBundle.items.filter((item) => item.id.startsWith("item:fp-")).length,
    184,
  );
  assert.equal(
    publicBundle.items.filter((item) => item.id.startsWith("item:md-")).length,
    2,
  );
  assert.equal(publicBundle.metrics.length, 13);
  assert.equal(publicBundle.workGroups.length, 82);
  assert.equal(publicBundle.metricGroups.length, 4);
  assert.equal(publicBundle.evidence.length, 198);

  const expectedCategories = {
    article: 15,
    course: 3,
    event: 49,
    external_reference: 24,
    mirror: 12,
    open_source_pr: 22,
    open_source_repo: 8,
    producer_credit: 4,
    profile: 6,
    recording: 23,
    technical_report: 9,
    translation: 11,
  };
  const actualCategories = Object.fromEntries(
    [...new Set(publicBundle.items.map((item) => item.type))]
      .sort()
      .map((type) => [
        type,
        publicBundle.items.filter((item) => item.type === type).length,
      ]),
  );
  assert.deepEqual(actualCategories, expectedCategories);
  assert.equal(
    publicBundle.items.reduce((sum, item) => sum + (item.durationSeconds || 0), 0),
    69_194,
  );
});

test("curated GitHub publication dates resolve every WorkGroup period", () => {
  const expectedDates = new Map([
    ["open_source_repo:undated:fugue", "2026-07-08"],
    ["open_source_repo:undated:wandb-skills", "2026-03-03"],
    ["open_source_repo:undated:groq-webinar-codegen-testing", "2024-08-01"],
    ["open_source_pr:undated:pii-safeguards-6", "2024-12-02"],
    [
      "open_source_pr:undated:diffusers-w-and-b-integration-1209",
      "2022-11-09",
    ],
    [
      "open_source_pr:undated:diffusers-w-and-b-integration-1245",
      "2022-11-10",
    ],
    ["open_source_pr:undated:openai-cookbook-419", "2023-05-12"],
    ["open_source_pr:undated:openai-cookbook-420", "2023-05-12"],
    ["open_source_pr:undated:open-interpreter-390", "2023-09-15"],
    ["open_source_pr:undated:gpt-engineer-701", "2023-09-15"],
    ["open_source_pr:undated:gpt-engineer-752", "2023-10-02"],
    [
      "open_source_pr:undated:google-cloud-generative-ai-1807",
      "2025-03-07",
    ],
    ["open_source_pr:undated:nvidia-data-flywheel-11", "2025-06-03"],
  ]);

  for (const [legacyId, date] of expectedDates) {
    const item = publicBundle.items.find((candidate) =>
      candidate.legacyIds.includes(legacyId),
    );
    assert(item, legacyId);
    assert.equal(item.date.start, date, legacyId);
    assert.equal(item.date.basis, "publication_date", legacyId);
  }

  assert.equal(
    publicBundle.workGroups.filter(
      (group) => group.yearStart === null && group.yearEnd === null,
    ).length,
    0,
  );
});

test("stable IDs and typed references resolve", () => {
  for (const values of [
    publicBundle.items,
    publicBundle.entities,
    publicBundle.workGroups,
    publicBundle.metrics,
    publicBundle.metricGroups,
    publicBundle.evidence,
    publicBundle.relations,
    publicBundle.collections,
    publicBundle.narratives,
  ]) {
    assert.equal(new Set(values.map((entry) => entry.id)).size, values.length);
  }

  const itemIds = new Set(publicBundle.items.map((item) => item.id));
  const entityIds = new Set(publicBundle.entities.map((entity) => entity.id));
  const workGroupIds = new Set(publicBundle.workGroups.map((group) => group.id));
  const metricIds = new Set(publicBundle.metrics.map((metric) => metric.id));
  const evidenceIds = new Set(publicBundle.evidence.map((evidence) => evidence.id));
  const collectionIds = new Set(publicBundle.collections.map((collection) => collection.id));
  const subjectIds = new Set([
    ...itemIds,
    ...entityIds,
    ...workGroupIds,
    ...collectionIds,
    publicBundle.profile.id,
  ]);

  for (const item of publicBundle.items) {
    assert.match(item.id, /^item:(?:fp|md)-\d{4}$/);
    assert(item.legacyIds.length >= 1, item.id);
    assert(entityIds.has(item.canonicalEntityId), item.canonicalEntityId);
  }
  for (const entity of publicBundle.entities) {
    for (const itemId of entity.itemIds) assert(itemIds.has(itemId), itemId);
    for (const parentId of entity.parentEntityIds) assert(entityIds.has(parentId), parentId);
  }
  for (const group of publicBundle.workGroups) {
    assert(entityIds.has(group.primaryEntityId), group.primaryEntityId);
    assert(group.memberEntityIds.includes(group.primaryEntityId), group.id);
    for (const entityId of [
      ...group.memberEntityIds,
      ...group.programEntityIds,
      ...group.contextEntityIds,
    ]) {
      assert(entityIds.has(entityId), `${group.id}: ${entityId}`);
    }
    for (const itemId of group.itemIds) assert(itemIds.has(itemId), itemId);
  }
  for (const relation of publicBundle.relations) {
    assert(itemIds.has(relation.fromId), relation.fromId);
    assert(itemIds.has(relation.toId), relation.toId);
  }
  for (const metric of publicBundle.metrics) {
    assert(subjectIds.has(metric.subjectId), metric.subjectId);
    for (const evidenceId of metric.publicEvidenceIds) assert(evidenceIds.has(evidenceId));
  }
  for (const collection of publicBundle.collections) {
    for (const itemId of collection.itemIds) assert(itemIds.has(itemId));
    for (const metricId of collection.metricIds) assert(metricIds.has(metricId));
  }
  for (const group of publicBundle.metricGroups) {
    assert(metricIds.has(group.leadMetricId), group.leadMetricId);
    for (const metricId of group.metricIds) assert(metricIds.has(metricId));
  }
  assert.equal(workGroupIds.size, publicBundle.workGroups.length);

  assert.deepEqual(
    [...new Set(publicBundle.relations.map((relation) => relation.predicate))].sort(),
    [
      "derivative_of",
      "implements",
      "mirror_of",
      "part_of",
      "recording_of",
      "references",
      "translation_of",
    ],
  );
});

test("every portfolio slug is stable and route-unique", () => {
  const slugs = publicBundle.items.map((item) => item.slug);
  assert.equal(new Set(slugs).size, publicBundle.items.length);

  const pairedTitle = "Mastering MLOps with W&B and Microsoft Phi-2";
  const pairedItems = publicBundle.items.filter((item) => item.title === pairedTitle);
  assert.deepEqual(
    pairedItems.map((item) => item.type).sort(),
    ["event", "recording"],
  );
  assert.equal(new Set(pairedItems.map((item) => item.slug)).size, 2);
  assert(pairedItems.every((item) => item.slug.includes(`-${item.type}-`)));

  const longTitle = publicBundle.items.find((item) =>
    item.legacyIds.includes(
      "article:2024-11-19:automated-medical-note-generation-fine-tuning-gpt-models-for-clinical-documentation-usin",
    ),
  );
  assert(longTitle);
  assert(!longTitle.slug.endsWith("-usin"));
  assert(
    longTitle.slugAliases.includes(
      "automated-medical-note-generation-fine-tuning-gpt-models-for-clinical-documentation-usin",
    ),
  );
});

test("v1.1 relations and canonical group corrections are explicit", () => {
  const byLegacyId = new Map(
    publicBundle.items.flatMap((item) =>
      item.legacyIds.map((legacyId) => [legacyId, item]),
    ),
  );
  const recording = byLegacyId.get(
    "recording:2025-10-06:architecting-and-orchestrating-ai-agents",
  );
  const correctEvent = byLegacyId.get(
    "event:2025-10-06:architecting-and-orchestrating-ai-agents",
  );
  const wrongEvent = byLegacyId.get(
    "event:2025-06-17:architecting-and-orchestrating-ai-agents",
  );
  assert(recording && correctEvent && wrongEvent);
  assert(
    publicBundle.relations.some(
      (relation) =>
        relation.predicate === "recording_of" &&
        relation.fromId === recording.id &&
        relation.toId === correctEvent.id,
    ),
  );
  assert(
    !publicBundle.relations.some(
      (relation) =>
        relation.predicate === "recording_of" &&
        relation.fromId === recording.id &&
        relation.toId === wrongEvent.id,
    ),
  );
  assert.equal(recording.canonicalEntityId, correctEvent.canonicalEntityId);
  assert.notEqual(recording.canonicalEntityId, wrongEvent.canonicalEntityId);

  const evalForge = publicBundle.items.find((item) => item.id === "item:md-0002");
  const primer = byLegacyId.get(
    "external_reference:2024-09:you-need-evals-a-primer-and-new-techniques",
  );
  const fugue = byLegacyId.get("open_source_repo:undated:fugue");
  assert(evalForge && primer && fugue);
  assert(
    publicBundle.relations.some(
      (relation) =>
        relation.predicate === "references" &&
        relation.fromId === primer.id &&
        relation.toId === evalForge.id,
    ),
  );
  assert(
    !publicBundle.relations.some(
      (relation) =>
        relation.predicate === "references" &&
        relation.fromId === primer.id &&
        relation.toId === fugue.id,
    ),
  );

  const ptl19297 = publicBundle.items.find((item) => item.id === "item:md-0001");
  assert.equal(
    ptl19297?.urls[0]?.url,
    "https://github.com/Lightning-AI/pytorch-lightning/pull/19297",
  );
  assert.equal(ptl19297?.canonicalEntityId, "entity:wk-0002");
  assert.deepEqual(
    publicBundle.entities.find((entity) => entity.id === "entity:wk-0002")?.childCounts,
    { items: 3, occurrences: 0, artifacts: 3 },
  );
});

test("public metrics have explicit scope and never imply collection inheritance", () => {
  for (const metric of publicBundle.metrics) {
    assert(
      ["item", "work", "occurrence", "program", "collection", "portfolio"].includes(
        metric.scope,
      ),
    );
    assert(["direct", "associated", "contextual"].includes(metric.attribution));
    assert(Array.isArray(metric.displaySurfaces));
  }
  assert.equal(
    publicBundle.metrics.filter((metric) =>
      metric.displaySurfaces.includes("item_detail"),
    ).length,
    7,
  );
  assert(
    publicBundle.metrics
      .filter((metric) => metric.displaySurfaces.includes("item_detail"))
      .every((metric) => metric.scope === "work" && metric.attribution === "direct"),
  );
  assert(
    publicBundle.metrics
      .filter((metric) => metric.scope === "collection" || metric.scope === "program")
      .every((metric) => !metric.displaySurfaces.includes("item_detail")),
  );
});

test("known public URL correction is present and superseded Play narrative is absent", () => {
  const serialized = JSON.stringify(publicBundle);
  assert(
    !serialized.includes(
      "how-to-adapt-your-llm-for-question-answering-with-prompt-tuning-using-nvidia-nemo-and-weights-and-biases-2",
    ),
  );
  assert(
    serialized.includes(
      "how-to-adapt-your-llm-for-question-answering-with-prompt-tuning-using-nvidia-nemo-and-weights-biases-2",
    ),
  );
  assert(!publicBundle.collections.some((collection) => collection.id === "collection:impact-film-v1"));
  assert.deepEqual(
    publicBundle.narratives.filter((narrative) => narrative.placement === "play"),
    [],
  );
});

test("owner bundle retains source accounting when available", { skip: !existsSync(OWNER_PATH) }, () => {
  const ownerBundle = JSON.parse(readFileSync(OWNER_PATH, "utf8"));
  assert.equal(ownerBundle.items.length, 186);
  assert.equal(
    ownerBundle.items.filter(
      (item) => item.sourceRecord?.snapshotId === "snapshot:public-footprint-csv",
    ).length,
    184,
  );
  assert.equal(
    ownerBundle.metrics.filter((metric) => Object.hasOwn(metric, "sourceRecord")).length,
    85,
  );
  assert.equal(ownerBundle.sourceSnapshots.length, 8);
  assert(ownerBundle.groupingLedger);
  assert(ownerBundle.items.every((item) => item.sourceRecord?.fingerprint));
  assert.deepEqual(ownerBundle.sourceSummary, publicBundle.sourceSummary);
});

test("generated schema exposes the canonical contract", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "1.2");
  assert(schema.required.includes("entities"));
  assert(schema.required.includes("workGroups"));
  assert(schema.required.includes("metricGroups"));
  assert(schema.required.includes("sourceSummary"));
  assert(schema.required.includes("sourceSnapshots"));
  assert(schema.$defs.entity.required.includes("sourceBasis"));
  assert.equal(
    schema.$defs.item.properties.additionalDates.items.$ref,
    "#/$defs/additionalContentDate",
  );
  assert.deepEqual(schema.$defs.relation.properties.predicate.enum, [
    "recording_of",
    "mirror_of",
    "translation_of",
    "derivative_of",
    "part_of",
    "implements",
    "references",
  ]);
  assert.deepEqual(schema.$defs.entity.properties.kind.enum, [
    "work",
    "occurrence",
    "artifact",
    "program",
  ]);
  assert(schema.$defs.metric.required.includes("displaySurfaces"));
  assert(schema.$defs.workGroup.required.includes("roleSummary"));
  assert(schema.$defs.workGroup.required.includes("programEntityIds"));
  assert.equal(schema.$defs.workGroup.properties.period.additionalProperties, false);
  assert.deepEqual(schema.$defs.metricPresentationGroup.properties.theme.enum, [
    "learning",
    "product",
    "programs",
    "archive",
  ]);
});

test(
  "regeneration is byte-for-byte deterministic",
  { skip: !existsSync(FOOTPRINT_PATH) || !existsSync(IMPACT_PATH) || !existsSync(OWNER_PATH) },
  () => {
    const result = spawnSync(process.execPath, ["scripts/build-content.mjs", "--check"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Checked content [a-f0-9]{16}/);
  },
);
