import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPortfolioUpdates } from "../scripts/content/updates.mjs";
import { buildPublicMetrics } from "../scripts/content/metrics.mjs";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const bundle = read("../content/public/anish-content.public.v1.json");
const updates = read("../content/curation/portfolio-updates.v1.json");
const curation = read("../content/curation/content-v1.1.json");
const groups = read("../content/curation/work-groups.v1.json");
const claims = read("../content/curation/public-claim-upgrades.v1.json");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const newSlugs = [
  "aria", "agent-lens-evaluation", "your-agent-learned-to-cheat",
  "autoresearch-labs", "rl-fine-tuning-workshop", "demo-generation-tooling",
];

test("six reviewed projects add sixteen observations without duplicating projects", () => {
  assert.equal(bundle.workGroups.length, 88);
  assert.equal(bundle.items.length, 202);
  assert.deepEqual(
    bundle.workGroups.filter(({ id }) => id.startsWith("group:portfolio:")).map(({ slug }) => slug).sort(),
    [...newSlugs].sort(),
  );
  for (const item of updates.items) {
    assert.equal(bundle.workGroups.filter(({ itemIds }) => itemIds.includes(item.id)).length, 1);
  }
  for (const [slug, observations] of [["aria", 3], ["agent-lens-evaluation", 2], ["autoresearch-labs", 1]]) {
    assert.equal(bundle.workGroups.find((group) => group.slug === slug).itemIds.length, observations);
  }
});

test("the original inventory, canonical IDs, and route slugs remain unchanged", () => {
  assert.equal(hash(bundle.items.filter(({ id }) => !id.startsWith("item:up-"))),
    "d934e728e4c79479ae16090ab436b21a98a28db9beb105033d48367217b5bc3f");
  assert.equal(hash(bundle.workGroups.filter(({ id }) => !id.startsWith("group:portfolio:")).map(({ id, slug }) => [id, slug]).sort()),
    "9c712129f4773d551e5956291b4a3fa638e66e51275095b36fc7241a7c45f195");
  assert.equal(hash(bundle.entities.filter(({ id }) => !id.includes("-up-")).map(({ id, slug, primaryItemId }) => [id, slug, primaryItemId]).sort()),
    "40ca2f32abed28486a7c417b5fe0056394c75e827c4dc77ccccfc25e388dc773");
  assert.equal(bundle.workGroups.find(({ slug }) => slug === "wandb-mcp-server").period.start, "2026-05-21");
  const originalEvidence = bundle.evidence.filter(({ capturedAt }) => capturedAt !== updates.reviewedAt);
  assert.equal(originalEvidence.length, 198);
  assert.equal(hash(originalEvidence), "10d434e06e89d79480bfee6112c1cfc309e54164047016149be437ac94cbe739");
});

test("nonpublic materials have owner-reviewed provenance, no private link, and an honest status", () => {
  for (const slug of ["autoresearch-labs", "rl-fine-tuning-workshop", "demo-generation-tooling"]) {
    const group = bundle.workGroups.find((entry) => entry.slug === slug);
    const item = bundle.items.find(({ id }) => id === group.itemIds[0]);
    assert.deepEqual(item.urls, []);
    assert(item.evidenceIds.includes("evidence:methodology:owner-reviewed-work"));
    assert.match(item.status, /curriculum|internal tooling/i);
  }
  const text = JSON.stringify(updates);
  assert.doesNotMatch(text, /github\.com\/(?:wandb\/(?:core|ai-sidequests|demo_gen)|ash0ts\/workshop)(?:\/|")/i);
  assert.doesNotMatch(text, /slack\.com|hex\.tech|notion\.|\/Users\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(text, /PatchPilot|Hill Climb|sourcing.agent|7\.9\/10|14.responses/i);
  assert.match(bundle.items.find(({ id }) => id === "item:up-0002").role, /published byline: The CoreWeave Team/);
  assert.match(bundle.items.find(({ id }) => id === "item:up-0006").role, /co-instructor with Lorenzo/);
});

test("merge and article-update dates never masquerade as publication or delivery", () => {
  const item = (id) => bundle.items.find((entry) => entry.id === id);
  assert.equal(item("item:up-0006").date.basis, "event_date");
  assert.equal(item("item:up-0006").date.start, "2026-10-01");
  assert.equal(item("item:up-0002").date.basis, "publication_date");
  for (const id of ["item:up-0004", "item:up-0005", "item:up-0007", "item:up-0009", "item:up-0010"]) {
    assert.equal(item(id).date.basis, "unknown");
    assert.match(item(id).status, /updated|merged/i);
  }
  assert.equal(item("item:up-0008").date.precision, "year");
  assert.equal(bundle.generatedAt, "2026-10-22T00:00:00.000Z");
});

test("owner-validated October measures keep units, windows, limits, and dated source history", () => {
  assert.equal(updates.metricObservations.length, 5);
  assert.equal(bundle.metrics.length, 17);
  const current = bundle.metrics.filter(({ id }) => id.endsWith(":2026-10-22"));
  assert.deepEqual(current.map(({ displayValue }) => displayValue).sort(), ["745K+", "76%", "70%", "≈4,800", "30"].sort());
  const calls = current.find(({ key }) => key === "all_time_tool_calls");
  assert.equal(calls.period.end, null, "A review date must not become a measurement cutoff");
  assert.match(calls.qualifier, /not HTTP requests or sessions/);
  assert(current.filter((m) => m !== calls).every((m) => !m.displaySurfaces.includes("homepage")));
  const growth = current.find(({ displayValue }) => displayValue === "76%");
  assert.equal(growth.period.start, "2026-04-19");
  assert.equal(growth.period.end, "2026-10-10");
  assert.match(growth.qualifier, /368.5.*649.*consistent identity handling/);
  assert.match(current.find(({ displayValue }) => displayValue === "70%").qualifier, /not cohort retention/);
  assert.match(current.find(({ displayValue }) => displayValue === "≈4,800").qualifier, /not verified distinct people/);
  assert.match(current.find(({ displayValue }) => displayValue === "30").qualifier, /not a current count, customer count, endorsement/);
  assert(claims.claims.some(({ id }) => id.endsWith("tool-calls:2026-07-29")), "Retain the historical reviewed checkpoint");
  const audience = bundle.metrics.find(({ label }) => label.includes("W&B organizations"));
  assert.match(audience.qualifier, /not distinct companies or currently active accounts/);
});

test("reviewed update input is additive and rejects ambiguous dates, links, and identities", () => {
  const original = JSON.stringify([curation, groups]);
  assert.equal(applyPortfolioUpdates(curation, groups, updates).curation.supplementalItems.length, 18);
  assert.equal(JSON.stringify([curation, groups]), original);
  for (const change of [
    (value) => { value.schemaVersion = "2.0"; },
    (value) => { value.reviewedAt = "today"; },
    (value) => { value.privateNotes = "not allowed"; },
    (value) => { value.items.push(value.items[0]); },
    (value) => { value.items[0].dateBasis = "release"; },
    (value) => { value.items[0].dateStart = "2027-01-01"; },
    (value) => { delete value.items[0].materials; },
    (value) => { value.items[0].primaryUrl = "https://example.com/private"; },
    (value) => { value.items[1].primaryUrl = "javascript:alert(1)"; },
    (value) => { value.groups.push(groups.groups[0]); },
    (value) => { value.entities.find(({ id }) => id === "entity:wk-0001").slug = "replacement"; },
    (value) => { value.metricObservations.push({ value: 100 }); },
  ]) {
    const value = structuredClone(updates);
    change(value);
    assert.throws(() => applyPortfolioUpdates(curation, groups, value));
  }
});

test("metric additions and replacements require one matching dated source and reviewed display", () => {
  assert.throws(() => buildPublicMetrics([], bundle.items, bundle.entities, {
    ...claims, additions: [{ id: "metric:new", publicationState: "public" }],
  }), /unique dated/);
  assert.throws(() => buildPublicMetrics([], bundle.items, bundle.entities, {
    ...claims, claims: [{ ...claims.claims[0], replacesMetricId: "missing" }],
  }), /unresolved/);
  assert.throws(() => buildPublicMetrics([], bundle.items, bundle.entities, claims), /matched 0 rows/);
});
