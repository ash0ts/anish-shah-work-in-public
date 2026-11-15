import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { buildCopyDeck, copyRiskManifest, parseCopyDocument, workGroupFieldEntries } from "../scripts/lib/copy-deck.mjs";
import { WORK_GROUP_COPY_DEFINITIONS } from "../lib/copy-contract.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const deck = await buildCopyDeck(root);
const { splitMetricHistory, historicalMetricIds } = await tsImport("../lib/metric-history.ts", import.meta.url);

test("all 88 presentations bound optional fact-checked notes", async () => {
  const risks = new Map((await copyRiskManifest(root)).map((entry) => [entry.key, entry.risk]));
  assert.equal(Object.keys(deck.workGroups).length, 88);
  for (const [id, copy] of Object.entries(deck.workGroups)) {
    for (const [key, maximum] of [["workDone", 3], ["impact", 2], ["skills", 5]]) {
      if (!copy[key]) continue;
      assert(copy[key].length > 0 && copy[key].length <= maximum, id);
      assert.equal(new Set(copy[key]).size, copy[key].length);
      for (const value of copy[key]) assert.doesNotMatch(value, /\b(?:I|my|unique users|customers)\b|https?:|\/Users\//iu);
    }
    for (const [field] of workGroupFieldEntries(copy).filter(([key]) => /^(?:work-done|impact|skill)-/u.test(key))) {
      assert.equal(risks.get(`${id}.${field}`), "fact_check");
    }
  }
  const mcp = deck.publicBundle.workGroups.find(({ slug }) => slug === "wandb-mcp-server");
  assert.deepEqual(deck.workGroups[mcp.id].impact, ["Fixed analytics output that broke Claude Desktop connections.", "Repaired incomplete run-history results."]);
});

test("presentation fields reject extra slots and executable content", () => {
  const source = "<!-- copy-record: group:test -->\n\n## display-title\nA project\n\n## short-title\nProject\n\n## summary\nA bounded project summary with factual detail.\n\n## role-summary\nProject author\n";
  const parse = (extra) => parseCopyDocument({file:"fixture",source:source+extra,expectedMarker:"<!-- copy-record: group:test -->",definitions:WORK_GROUP_COPY_DEFINITIONS});
  for (const field of ["work-done-4", "impact-3", "skill-6"]) assert.throws(() => parse(`\n## ${field}\nUnsupported\n`), /unknown field/);
  assert.throws(() => parse("\n## skill-1\n<script>alert(1)</script>\n"), /markup/);
});

test("new MCP figures preserve owner-reported units without invented definitions", () => {
  for (const [part, value, label] of [["users-owner-report", "5,000+", "users"], ["wreus-owner-report", "500", "WREUs"]]) {
    const metric = deck.publicBundle.metrics.find(({ id }) => id === `metric:project:wandb-mcp-server:${part}:2026-11-15`);
    assert.equal(metric.displayValue, value);
    assert.equal(metric.label, label);
    assert.equal(metric.verificationState, "tentative");
    assert.equal(metric.sourceLabel, "Owner report");
    assert.deepEqual(metric.displaySurfaces, ["homepage", "item_detail", "sources"]);
    assert.deepEqual(metric.period, {start:null,end:null,asOf:"2026-11-15",label:"Owner-reported November 15, 2026"});
    assert.doesNotMatch(JSON.stringify(metric), /weekly|unique|active users|customers|retention/i);
    assert.deepEqual(metric.publicEvidenceIds, ["evidence:methodology:owner-reported-metrics"]);
  }
  const old = deck.publicBundle.metrics.find(({ id }) => id.includes(":lifetime-identities:"));
  assert.equal(old.displayValue, "≈4,800");
  assert.match(old.label, /identities/);
  assert(historicalMetricIds.has(old.id));
});

test("historical observations are complete, disjoint and source-linkable", () => {
  const { current, historical } = splitMetricHistory(deck.publicBundle.metrics);
  assert.equal(current.length + historical.length, deck.publicBundle.metrics.length);
  assert.equal(new Set([...current, ...historical].map(({ id }) => id)).size, deck.publicBundle.metrics.length);
  for (const id of historicalMetricIds) assert(deck.publicBundle.metrics.some((metric) => metric.id === id), id);
  for (const metric of historical) assert(metric.qualifier && metric.period.label && metric.publicEvidenceIds.length);
});

test("Home keeps three signals plus the explicitly requested owner reports", async () => {
  const manifest = JSON.parse(await readFile(new URL("../content/presentation/home-overview.v2.json", import.meta.url), "utf8"));
  assert.equal(manifest.signals.length, 3);
  assert.deepEqual(manifest.signals.map(({ metricId }) => deck.publicBundle.metrics.find(({ id }) => id === metricId).displayValue), ["1M+", "10K+", "$8M+"]);
  assert.equal(deck.pages.home["proof-3-label"], "Event pipeline supported");
  for (const signal of manifest.signals) assert(signal.explanation.length <= 100);
  assert.deepEqual(manifest.supportingMetricIds.map((id) => deck.publicBundle.metrics.find((metric) => metric.id === id).displayValue), ["5,000+", "500"]);
});
