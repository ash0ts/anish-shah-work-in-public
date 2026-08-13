import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import publicBundle from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};

const {
  contributionFacetDefinitions,
  countWorkFacetOptions,
  ecosystemFacetDefinitions,
  mediaFacetDefinitions,
  themeFacetDefinitions,
  workFacetsForRecord,
  workThemeFacetLabel,
} = await tsImport("../lib/work-facets.ts", import.meta.url);
const { workArchiveRecordsFrom } = await tsImport(
  "../lib/work-index.ts",
  import.meta.url,
);

const records = workArchiveRecordsFrom(publicBundle);

const expectedDefinitionCounts = {
  theme: 8,
  media: 5,
  ecosystem: 9,
  contribution: 6,
};

test("presentation facets use the compact reviewed vocabularies", () => {
  assert.equal(records.length, 82);
  assert.equal(themeFacetDefinitions.length, expectedDefinitionCounts.theme);
  assert.equal(mediaFacetDefinitions.length, expectedDefinitionCounts.media);
  assert.equal(
    ecosystemFacetDefinitions.length,
    expectedDefinitionCounts.ecosystem,
  );
  assert.equal(
    contributionFacetDefinitions.length,
    expectedDefinitionCounts.contribution,
  );
});

test("theme facet labels are shared by filters and evidence-leaf navigation", () => {
  for (const { id, label } of themeFacetDefinitions) {
    assert.equal(workThemeFacetLabel(id), label);
  }
});

test("all public WorkGroups derive valid presentation-only facets", () => {
  const validThemes = new Set(themeFacetDefinitions.map(({ id }) => id));
  const validMedia = new Set(mediaFacetDefinitions.map(({ id }) => id));
  const validEcosystems = new Set(
    ecosystemFacetDefinitions.map(({ id }) => id),
  );
  const validContributions = new Set(
    contributionFacetDefinitions.map(({ id }) => id),
  );

  for (const record of records) {
    const facets = workFacetsForRecord(record);
    assert.deepEqual(facets.theme, [...new Set(facets.theme)], record.id);
    assert.deepEqual(facets.media, [...new Set(facets.media)], record.id);
    assert.deepEqual(
      facets.ecosystem,
      [...new Set(facets.ecosystem)],
      record.id,
    );
    assert(facets.theme.every((id) => validThemes.has(id)), record.id);
    assert(facets.media.length > 0, `${record.id} has no media facet`);
    assert(facets.media.every((id) => validMedia.has(id)), record.id);
    assert(
      facets.ecosystem.length > 0,
      `${record.id} has no ecosystem facet`,
    );
    assert(
      facets.ecosystem.every((id) => validEcosystems.has(id)),
      record.id,
    );
    assert(validContributions.has(facets.contribution), record.id);
  }
});

test("facet counts are stable, multi-mapped, and select-ready", () => {
  const optionCounts = (dimension) =>
    Object.fromEntries(
      countWorkFacetOptions(records, dimension).map(({ value, count }) => [
        value,
        count,
      ]),
    );

  assert.deepEqual(optionCounts("theme"), {
    "foundation-models": 26,
    "ml-systems-infrastructure": 22,
    "open-source-ecosystems": 20,
    "evaluation-observability": 17,
    "agent-systems": 13,
    "education-community": 9,
    "retrieval-knowledge-systems": 4,
    "applied-ml": 3,
  });
  assert.deepEqual(optionCounts("media"), {
    "live-session": 41,
    publication: 24,
    "recorded-media": 24,
    software: 20,
    course: 1,
  });
  assert.deepEqual(optionCounts("ecosystem"), {
    "weights-biases": 49,
    "open-source": 20,
    "events-communities": 13,
    "learning-media": 9,
    google: 7,
    microsoft: 7,
    "mlops-community": 5,
    nvidia: 4,
    "data-compute-platforms": 3,
  });
  assert.deepEqual(optionCounts("contribution"), {
    "speaker-presenter": 30,
    "author-coauthor": 21,
    "builder-contributor": 16,
    "instructor-educator": 10,
    "producer-reviewer": 3,
    "host-organizer": 2,
  });
});

test("combined organizations map to every applicable ecosystem", () => {
  const googleAndWandb = records.find(
    (record) => record.id === "group:courses:startup-school",
  );
  const microsoftAndNvidia = records.find(
    (record) => record.id === "group:talks:model-customization",
  );
  assert(googleAndWandb && microsoftAndNvidia);

  assert.deepEqual(workFacetsForRecord(googleAndWandb).ecosystem, [
    "weights-biases",
    "google",
  ]);
  assert.deepEqual(workFacetsForRecord(microsoftAndNvidia).ecosystem, [
    "weights-biases",
    "microsoft",
    "nvidia",
  ]);
});
