import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import publicBundleJson from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};
const {
  mergePublishedEditorialSnapshot,
  parsePublishedEditorialSnapshot,
  publishedRecordsHash,
  resolvePublicContentFromSnapshotRow,
} = await tsImport(
  "../lib/server/public-content-selector.ts",
  import.meta.url,
);
const {
  collectionMetricsFrom,
  entityForItemFrom,
  findEntityBySlugFrom,
  metricsForItemFrom,
  supplementalWorkEntriesFrom,
  workIndexEntriesFrom,
} = await tsImport("../lib/content-selectors.ts", import.meta.url);

const staticBundle = publicBundleJson;
const publishedAt = "2026-07-30T18:00:00.000Z";

function itemRecord(item, overrides = {}) {
  return {
    id: item.id,
    recordType: item.type,
    slug: item.slug,
    title: item.title,
    summary: item.summary ?? "",
    approvedPublicWording: "",
    caveat: "",
    featured: false,
    sortOrder: 0,
    verificationState: item.verificationState,
    evidenceAccess: "public_web",
    publicPayload: {},
    ...overrides,
  };
}

function metricRecord(metric, overrides = {}) {
  return {
    id: metric.id,
    recordType: "metric",
    slug: null,
    title: `${metric.displayValue} ${metric.label}`,
    summary: metric.qualifier ?? "",
    approvedPublicWording: "",
    caveat: "",
    featured: false,
    sortOrder: 0,
    verificationState: metric.verificationState,
    evidenceAccess: "public_web",
    publicPayload: {},
    ...overrides,
  };
}

function narrativeRecord(narrative, overrides = {}) {
  return {
    id: narrative.id,
    recordType: "narrative",
    slug: null,
    title: narrative.title,
    summary: narrative.body,
    approvedPublicWording: "",
    caveat: "",
    featured: false,
    sortOrder: 0,
    verificationState: "verified",
    evidenceAccess: "public_web",
    publicPayload: {},
    ...overrides,
  };
}

function workGroupRecord(group, overrides = {}) {
  return {
    id: group.id,
    recordType: "work_group",
    slug: group.slug,
    title: group.title,
    summary: group.summary,
    approvedPublicWording: group.summary,
    caveat: "",
    featured: group.featuredOrder !== null,
    sortOrder: group.featuredOrder ?? 30_000,
    verificationState: group.verificationState,
    evidenceAccess: "public_web",
    publicPayload: {},
    ...overrides,
  };
}

async function snapshotWith(records) {
  const contentHash = await publishedRecordsHash(
    records,
    staticBundle.contentVersion,
  );
  return {
    schemaVersion: "1.1",
    baseContentVersion: staticBundle.contentVersion,
    publishedAt,
    contentHash,
    records,
  };
}

test("canonical selectors expose explicit work groups without collection outcome leakage", () => {
  const byLegacyId = new Map(
    staticBundle.items.flatMap((item) =>
      item.legacyIds.map((legacyId) => [legacyId, item]),
    ),
  );
  const prompting = byLegacyId.get(
    "course:2024-07:developers-guide-to-llm-prompting",
  );
  const evals = byLegacyId.get("course:2025-01-07:llm-apps-evaluation");
  const unrelatedPr = byLegacyId.get("open_source_pr:undated:prompting-course-142");
  const oldEvent = byLegacyId.get(
    "event:2021-09-27:mlops-sample-project-end-to-end-song-recommender",
  );
  const mcp = byLegacyId.get("open_source_repo:undated:wandb-mcp-server");
  assert(prompting && evals && unrelatedPr && oldEvent && mcp);

  assert.deepEqual(metricsForItemFrom(staticBundle, prompting), []);
  assert.deepEqual(metricsForItemFrom(staticBundle, unrelatedPr), []);
  assert.deepEqual(metricsForItemFrom(staticBundle, oldEvent), []);
  assert.deepEqual(
    metricsForItemFrom(staticBundle, evals).map((metric) => metric.key),
    ["launch_signups"],
  );
  assert.deepEqual(
    metricsForItemFrom(staticBundle, mcp).map((metric) => metric.key),
    [
      "mcp_tool_calls",
      "mcp_users_and_organizations",
      "returning_user_share",
      "weekly_reengaged_users",
    ],
  );
  assert.equal(collectionMetricsFrom(staticBundle, "collection:events").length, 5);

  const mcpEntity = entityForItemFrom(staticBundle, mcp);
  assert.equal(mcpEntity?.id, "entity:wk-0001");
  assert.equal(findEntityBySlugFrom(staticBundle, "wandb-mcp-server")?.id, "entity:wk-0001");
  const workIndex = workIndexEntriesFrom(staticBundle);
  assert(workIndex.length > 0);
  assert(workIndex.every((entity) => entity.countability === "unique_work"));
  assert(workIndex.every((entity) => entity.sourceBasis !== "supplemental"));
  assert.deepEqual(
    supplementalWorkEntriesFrom(staticBundle).map((entity) => entity.id),
    ["entity:wk-0003"],
  );
});

test("published selector applies only visibility, order, feature, wording, and caveat", async () => {
  const first = staticBundle.items[0];
  const second = staticBundle.items[1];
  const metric = staticBundle.metrics.find(
    (entry) => entry.subjectId.startsWith("collection:"),
  );
  const narrative = staticBundle.narratives.find(
    (entry) => entry.id === "narrative:play:personal-streams",
  );
  assert(first && second && metric && narrative);

  const snapshot = await snapshotWith([
    itemRecord(first, {
      sortOrder: 20,
      approvedPublicWording: "Reviewed public summary.",
      caveat: "Public caveat.",
    }),
    itemRecord(second, { sortOrder: -5, featured: true }),
    metricRecord(metric, {
      sortOrder: 2,
      approvedPublicWording: `${metric.displayValue} revised metric label`,
      caveat: "Reviewed metric caveat.",
    }),
    narrativeRecord(narrative, {
      approvedPublicWording: "Updated personal-stream copy.",
    }),
  ]);
  const merged = mergePublishedEditorialSnapshot(staticBundle, snapshot);
  assert(merged);

  assert.deepEqual(
    merged.items.map((item) => item.id),
    [second.id, first.id],
  );
  assert.equal(merged.items[0].featured, true);
  assert.equal(
    merged.items[1].summary,
    "Reviewed public summary. — Public caveat.",
  );
  assert.equal(merged.items[1].title, first.title);
  assert.deepEqual(merged.items[1].urls, first.urls);
  assert.equal(merged.metrics.length, 1);
  assert.equal(merged.metrics[0].label, "revised metric label");
  assert.equal(merged.metrics[0].qualifier, "Reviewed metric caveat.");
  assert.equal(merged.narratives.length, 1);
  assert.equal(merged.narratives[0].body, "Updated personal-stream copy.");
  const survivingEvidenceIds = new Set([
    ...merged.items.flatMap((item) => item.evidenceIds),
    ...merged.metrics.flatMap((entry) => entry.publicEvidenceIds),
  ]);
  assert(
    merged.evidence.every(
      (source) =>
        source.kind === "methodology" || survivingEvidenceIds.has(source.id),
    ),
  );
  assert(
    staticBundle.evidence.some(
      (source) =>
        source.kind !== "methodology" &&
        !survivingEvidenceIds.has(source.id) &&
        !merged.evidence.some((candidate) => candidate.id === source.id),
    ),
  );
  assert(
    merged.relations.every(
      (relation) =>
        merged.items.some((item) => item.id === relation.fromId) &&
        merged.items.some((item) => item.id === relation.toId),
    ),
  );
});

test("published WorkGroups resolve only against visible member records", async () => {
  const group = staticBundle.workGroups.find(
    (entry) => entry.id === "group:products:wandb-mcp",
  );
  assert(group);
  const items = group.itemIds.map((id) =>
    staticBundle.items.find((item) => item.id === id),
  );
  assert(items.every(Boolean));

  const snapshot = await snapshotWith([
    ...items.map((item, index) =>
      itemRecord(item, { sortOrder: index }),
    ),
    workGroupRecord(group, {
      approvedPublicWording: "A compact public summary.",
      caveat: "Evidence stays attached.",
      featured: false,
    }),
  ]);
  const merged = mergePublishedEditorialSnapshot(staticBundle, snapshot);
  assert(merged);
  assert.equal(merged.workGroups.length, 1);
  assert.equal(merged.workGroups[0].id, group.id);
  assert.equal(merged.workGroups[0].featuredOrder, null);
  assert.equal(
    merged.workGroups[0].summary,
    "A compact public summary. — Evidence stays attached.",
  );

  const emptySnapshot = await snapshotWith([workGroupRecord(group)]);
  const empty = mergePublishedEditorialSnapshot(staticBundle, emptySnapshot);
  assert(empty);
  assert.equal(empty.workGroups.length, 0);
});

test("published selector rejects raw HTML, private fields, and malformed records", async () => {
  const item = staticBundle.items[0];
  const safe = itemRecord(item);
  const hash = "0".repeat(64);

  assert.equal(
    parsePublishedEditorialSnapshot({
      schemaVersion: "1.1",
      baseContentVersion: staticBundle.contentVersion,
      publishedAt,
      contentHash: hash,
      records: [{ ...safe, approvedPublicWording: "<b>unsafe</b>" }],
    }),
    null,
  );
  assert.equal(
    parsePublishedEditorialSnapshot({
      schemaVersion: "1.1",
      baseContentVersion: staticBundle.contentVersion,
      publishedAt,
      contentHash: hash,
      records: [{ ...safe, privateNotes: "do not publish" }],
    }),
    null,
  );
  assert.equal(
    parsePublishedEditorialSnapshot({
      schemaVersion: "1.1",
      baseContentVersion: staticBundle.contentVersion,
      publishedAt,
      contentHash: hash,
      records: [{ ...safe, sortOrder: 1.5 }],
    }),
    null,
  );
});

test("resolver verifies the content hash and falls back safely without D1", async () => {
  const fallback = await resolvePublicContentFromSnapshotRow(staticBundle, null);
  assert.equal(fallback.source, "static_fallback");
  assert.equal(fallback.bundle, staticBundle);

  const item = staticBundle.items[0];
  const snapshot = await snapshotWith([itemRecord(item)]);
  const published = await resolvePublicContentFromSnapshotRow(staticBundle, {
    snapshotJson: JSON.stringify(snapshot),
    contentHash: snapshot.contentHash,
  });
  assert.equal(published.source, "published_snapshot");
  assert.deepEqual(published.bundle.items.map((entry) => entry.id), [item.id]);

  const tampered = await resolvePublicContentFromSnapshotRow(staticBundle, {
    snapshotJson: JSON.stringify({
      ...snapshot,
      records: [{ ...snapshot.records[0], featured: true }],
    }),
    contentHash: snapshot.contentHash,
  });
  assert.equal(tampered.source, "static_fallback");
  assert.equal(tampered.bundle, staticBundle);

  const staleVersion = "0".repeat(16);
  const staleContentHash = await publishedRecordsHash(
    snapshot.records,
    staleVersion,
  );
  const stale = await resolvePublicContentFromSnapshotRow(staticBundle, {
    snapshotJson: JSON.stringify({
      ...snapshot,
      baseContentVersion: staleVersion,
      contentHash: staleContentHash,
    }),
    contentHash: staleContentHash,
  });
  assert.equal(stale.source, "static_fallback");
  assert.equal(stale.bundle, staticBundle);
});

test("public runtime reads publication snapshots, never editable drafts", async () => {
  const root = new URL("../", import.meta.url);
  const [runtime, home, work, detail, play, sources] = await Promise.all([
    readFile(new URL("lib/server/public-content.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/work/page.tsx", root), "utf8"),
    readFile(new URL("app/work/[slug]/page.tsx", root), "utf8"),
    readFile(new URL("app/play/page.tsx", root), "utf8"),
    readFile(new URL("app/sources/page.tsx", root), "utf8"),
  ]);

  assert.match(runtime, /FROM publication_snapshots/);
  assert.doesNotMatch(runtime, /FROM public_records/);
  for (const route of [home, work, detail, play, sources]) {
    assert.match(route, /getPublicContentView/);
    assert.match(route, /dynamic = "force-dynamic"/);
  }
  assert.equal(
    [...detail.matchAll(/\bresolveGroup\(/g)].length >= 3,
    true,
  );
});
