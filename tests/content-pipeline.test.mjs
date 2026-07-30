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
  assert.equal(publicBundle.schemaVersion, "1.0");
  assert.match(publicBundle.contentVersion, /^[a-f0-9]{16}$/);
  assert.equal(publicBundle.items.length, 184);
  assert.equal(publicBundle.metrics.length, 13);

  const expectedCategories = {
    article: 15,
    course: 3,
    event: 49,
    external_reference: 24,
    mirror: 12,
    open_source_pr: 21,
    open_source_repo: 7,
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

test("stable IDs and typed references resolve", () => {
  for (const values of [
    publicBundle.items,
    publicBundle.metrics,
    publicBundle.evidence,
    publicBundle.relations,
    publicBundle.collections,
    publicBundle.narratives,
  ]) {
    assert.equal(new Set(values.map((entry) => entry.id)).size, values.length);
  }

  const itemIds = new Set(publicBundle.items.map((item) => item.id));
  const metricIds = new Set(publicBundle.metrics.map((metric) => metric.id));
  const evidenceIds = new Set(publicBundle.evidence.map((evidence) => evidence.id));
  const collectionIds = new Set(publicBundle.collections.map((collection) => collection.id));
  const subjectIds = new Set([...itemIds, ...collectionIds, publicBundle.profile.id]);

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
});

test("known public URL correction and personal-stream narrative are present", () => {
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
    [
      {
        id: "narrative:play:personal-streams",
        title: "Outside the work",
        body: "A consent-aware view of what Anish watches, reads, and moves through: owner-authorized MyAnimeList and Hardcover syncs, with Strava loaded only through official public embeds after visitor intent.",
        placement: "play",
        publicationState: "public",
      },
    ],
  );
});

test("owner bundle retains source accounting when available", { skip: !existsSync(OWNER_PATH) }, () => {
  const ownerBundle = JSON.parse(readFileSync(OWNER_PATH, "utf8"));
  assert.equal(ownerBundle.items.length, 184);
  assert.equal(
    ownerBundle.metrics.filter((metric) => Object.hasOwn(metric, "sourceRecord")).length,
    85,
  );
  assert.equal(ownerBundle.sourceSnapshots.length, 4);
  assert(ownerBundle.items.every((item) => item.sourceRecord?.fingerprint));
});

test("generated schema exposes the canonical contract", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert(schema.required.includes("sourceSnapshots"));
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
