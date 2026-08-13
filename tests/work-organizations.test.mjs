import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import publicBundle from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};
import manifest from "../content/presentation/work-organizations.v1.json" with {
  type: "json",
};

const {
  contextualWorkOrganizationMarksFrom,
  parseWorkOrganizationManifest,
  validateWorkOrganizationManifest,
  workOrganizationLabelForId,
  workOrganizationMarksFrom,
  workOrganizationSectionsFrom,
} = await tsImport("../lib/work-organizations.ts", import.meta.url);
const { workArchiveRecordsFrom } = await tsImport(
  "../lib/work-index.ts",
  import.meta.url,
);
const {
  filterWorkArchiveRecords,
  parseWorkArchiveQuery,
  workOrganizationFilterLabel,
} = await tsImport("../lib/work-archive-query.ts", import.meta.url);

test("the curated organization contract resolves exactly the vetted 24 marks", () => {
  const parsed = validateWorkOrganizationManifest(publicBundle);
  const resolved = workOrganizationMarksFrom(publicBundle);
  const sections = workOrganizationSectionsFrom(publicBundle);

  assert.equal(parsed.marks.length, 24);
  assert.equal(resolved.length, 24);
  assert.deepEqual(
    sections.map(({ id, marks }) => [id, marks.length]),
    [
      ["built-at", 1],
      ["contributed-to", 8],
      ["presented-with-or-at", 15],
    ],
  );
  assert(resolved.every(({ projectCount }) => projectCount > 0));
  assert.deepEqual(
    resolved.filter(({ logo }) => logo !== null).map(({ id }) => id),
    [
      "weights-biases",
      "hugging-face",
      "mlops-world",
      "datatalksclub",
      "ai-tinkerers",
    ],
  );
  assert.equal(
    resolved.find(({ id }) => id === "openai")?.logo,
    null,
    "A brand-page control without a verifiable raw asset keeps the fallback",
  );
  assert.equal(
    resolved.find(({ id }) => id === "weights-biases")?.projectCount,
    35,
  );
  assert.equal(
    resolved.find(({ id }) => id === "google-cloud")?.projectCount,
    7,
  );
});

test("every declared project intersects the mark's reviewed source organizations", () => {
  const groups = new Map(
    publicBundle.workGroups.map((group) => [group.id, group]),
  );

  for (const mark of manifest.marks) {
    const sourceIds = new Set(mark.sourceOrganizationIds);
    for (const groupId of mark.workGroupIds) {
      const group = groups.get(groupId);
      assert(group, `${mark.id} references missing ${groupId}`);
      assert(
        group.organizationIds.some((id) => sourceIds.has(id)),
        `${mark.id} has no organization evidence for ${groupId}`,
      );
    }
  }
});

test("strict validation rejects missing evidence and duplicate presentation identity", () => {
  const unsupported = structuredClone(manifest);
  unsupported.marks.find(({ id }) => id === "langchain").workGroupIds = [
    "group:products:openai-cookbook",
  ];
  assert.throws(
    () => validateWorkOrganizationManifest(publicBundle, unsupported),
    /work_organization_evidence_missing:langchain/u,
  );

  const duplicate = structuredClone(manifest);
  duplicate.marks[1].featuredOrder = duplicate.marks[0].featuredOrder;
  assert.throws(
    () => parseWorkOrganizationManifest(duplicate),
    /work_organization_manifest_duplicate/u,
  );
});

test("Work archive records carry mark IDs and curated organization queries return exact projects", () => {
  const records = workArchiveRecordsFrom(publicBundle);
  const google = workOrganizationMarksFrom(publicBundle).find(
    ({ id }) => id === "google-cloud",
  );
  assert(google);

  const results = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({ organization: "google-cloud" }),
  );
  assert.deepEqual(
    results.map(({ id }) => id).sort(),
    [...google.workGroupIds].sort(),
  );
  assert(
    results.every(({ organizationMarkIds }) =>
      organizationMarkIds.includes("google-cloud"),
    ),
  );
});

test("legacy raw organization and ecosystem query values remain compatible", () => {
  const records = workArchiveRecordsFrom(publicBundle);
  const rawResults = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({
      organization: "org:google-cloud-github",
    }),
  );
  assert.deepEqual(rawResults.map(({ id }) => id), [
    "group:standalone:ar-fp-0183",
  ]);

  const ecosystemResults = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({ organization: "google" }),
  );
  assert(ecosystemResults.length > 0);
  assert(
    ecosystemResults.every(({ organizationNames }) =>
      organizationNames.some((name) => /google/iu.test(name)),
    ),
  );
});

test("hidden WorkGroups disappear from mark counts and archive records", () => {
  const hiddenBundle = structuredClone(publicBundle);
  const hiddenId = "group:standalone:ar-fp-0183";
  hiddenBundle.workGroups.find(({ id }) => id === hiddenId).publicationState =
    "hidden";

  const google = workOrganizationMarksFrom(hiddenBundle).find(
    ({ id }) => id === "google-cloud",
  );
  assert(google);
  assert.equal(google.projectCount, 6);
  assert(!google.workGroupIds.includes(hiddenId));
  assert(!workArchiveRecordsFrom(hiddenBundle).some(({ id }) => id === hiddenId));
});

test("contextual marks use the complete filtered scope and retain a selected mark", () => {
  const records = workArchiveRecordsFrom(publicBundle);
  const allMarks = workOrganizationMarksFrom(publicBundle);
  const selected = allMarks.at(-1);
  assert(selected);

  const context = contextualWorkOrganizationMarksFrom(
    publicBundle,
    records,
    selected.id,
  );
  assert.equal(context.matchingMarkCount, 24);
  assert.equal(context.marks.length, 6);
  assert(context.marks.some(({ id }) => id === selected.id));
  assert(
    context.marks.every(({ projectCount, workGroupIds }) =>
      projectCount === workGroupIds.length,
    ),
  );

  const yearScope = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({ year: "2024" }),
  );
  const yearIds = new Set(yearScope.map(({ id }) => id));
  const yearContext = contextualWorkOrganizationMarksFrom(
    publicBundle,
    yearScope,
    null,
  );
  assert(yearContext.marks.length <= 6);
  assert(
    yearContext.marks.every(({ workGroupIds }) =>
      workGroupIds.every((id) => yearIds.has(id)),
    ),
  );
  assert.deepEqual(
    yearContext.marks.map(({ projectCount }) => projectCount),
    yearContext.marks
      .map(({ projectCount }) => projectCount)
      .toSorted((left, right) => right - left),
  );

  const selectedScope = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({ organization: selected.id }),
  );
  const selectedScopeIds = new Set(selectedScope.map(({ id }) => id));
  const selectedContext = contextualWorkOrganizationMarksFrom(
    publicBundle,
    selectedScope,
    selected.id,
  );
  assert(selectedContext.marks.some(({ id }) => id === selected.id));
  assert(
    selectedContext.marks.every(({ workGroupIds }) =>
      workGroupIds.every((id) => selectedScopeIds.has(id)),
    ),
  );
});

test("curated organization IDs produce reviewed human-readable labels", () => {
  assert.equal(workOrganizationLabelForId("google-cloud"), "Google Cloud");
  assert.equal(workOrganizationFilterLabel("google-cloud"), "Google Cloud");
  assert.equal(
    workOrganizationFilterLabel("org:google-cloud-github"),
    "Org:Google Cloud Github",
  );
  assert.equal(workOrganizationLabelForId("github"), undefined);
});
