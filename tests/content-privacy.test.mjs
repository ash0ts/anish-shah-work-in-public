import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../scripts/lib/csv.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_PATH = path.join(
  PROJECT_ROOT,
  "content/public/anish-content.public.v1.json",
);
const IMPACT_PATH = path.resolve(
  PROJECT_ROOT,
  "../anish_shah_impact_metrics_2021-2026.csv",
);
const publicText = readFileSync(PUBLIC_PATH, "utf8");
const publicBundle = JSON.parse(publicText);

const BLOCKED_PUBLIC_PATTERNS = [
  /app\.notion\.com/i,
  /notion\.so/i,
  /app\.hex\.tech/i,
  /coreweave\.enterprise\.slack\.com/i,
  /slack\.com\/archives/i,
  /\/users\//i,
  /documents\/new project/i,
];

test("public output contains no internal URLs or local paths", () => {
  for (const pattern of BLOCKED_PUBLIC_PATTERNS) {
    assert.doesNotMatch(publicText, pattern);
  }
  assert(publicBundle.evidence.every((evidence) => evidence.access === "public_web"));
  assert(publicBundle.items.every((item) => item.publicationState === "public"));
  assert(publicBundle.metrics.every((metric) => metric.publicationState === "public"));
  assert(!Object.hasOwn(publicBundle, "reviewClaims"));
  assert(!Object.hasOwn(publicBundle, "groupingLedger"));
});
test("public metrics expose reviewed display copy, never exact value fields", () => {
  const publicDisplays = new Set([
    "7K+",
    "About half",
    "1K+",
    "200K+",
    "More than two-thirds",
    "Hundreds",
    "$4M+",
    "$300K+",
    "500+",
    "1K+ / 500+",
    "49",
    "19+",
  ]);
  assert.equal(publicBundle.metrics.length, 13);
  for (const metric of publicBundle.metrics) {
    assert.equal(typeof metric.displayValue, "string");
    assert(publicDisplays.has(metric.displayValue), metric.displayValue);
    for (const key of ["value", "unit", "evidenceIds", "sourceRecord"]) {
      assert(!Object.hasOwn(metric, key), `${metric.id} exposes ${key}`);
    }
    assert(metric.period.asOf, `${metric.id} lacks an as-of date`);
    assert(metric.sourceLabel, `${metric.id} lacks a source label`);
    if (metric.key.includes("tool_calls")) {
      assert(!metric.displayValue.includes("$"), `${metric.id} formats calls as currency`);
    }
  }
});

test("selected public measure revisions stay rounded and omit exact source figures", () => {
  const calls = publicBundle.metrics.find(
    (metric) =>
      metric.id ===
      "metric:project:wandb-mcp-server:tool-calls:2026-07-29",
  );
  const pipeline = publicBundle.metrics.find(
    (metric) => metric.id === "metric:events:pipeline-supported:2024-2025",
  );
  assert.equal(calls?.displayValue, "200K+");
  assert.equal(calls?.period.asOf, "2026-07-29");
  assert(!calls.displayValue.includes("$"));
  assert.equal(pipeline?.displayValue, "$4M+");
  assert.equal(pipeline?.period.label, "2024–2025");
  assert(
    !publicBundle.metrics.some(
      (metric) =>
        metric.id ===
          "metric:project:wandb-mcp-server:tool-calls:2026-06-11" ||
        metric.id === "metric:events:pipeline-supported:2025",
    ),
  );
});

test(
  "large exact internal metric values do not appear in public metric records",
  { skip: !existsSync(IMPACT_PATH) },
  () => {
    const rows = parseCsv(readFileSync(IMPACT_PATH, "utf8"), path.basename(IMPACT_PATH));
    const publicMetricText = JSON.stringify(publicBundle.metrics);
    const privateExactValues = [
      ...new Set(
        rows
          .filter(
            (row) =>
              row.source_system !== "public_footprint" &&
              /^\d+(?:\.\d+)?$/.test(row.value) &&
              row.value.length >= 4,
          )
          .map((row) => row.value),
      ),
    ];
    for (const exactValue of privateExactValues) {
      assert(
        !publicMetricText.includes(exactValue),
        `Public metric records contain an exact internal value`,
      );
    }
  },
);

test("public provenance omits private source metadata", () => {
  for (const item of publicBundle.items) assert(!Object.hasOwn(item, "sourceRecord"));
  for (const snapshot of publicBundle.sourceSnapshots) {
    assert(!Object.hasOwn(snapshot, "sha256"));
    assert(!Object.hasOwn(snapshot, "sourceFile"));
  }
});

test("removed film artifacts and terminology do not survive in generated content", () => {
  assert(!existsSync(path.join(PROJECT_ROOT, "content/public/motion-story-manifest.v1.json")));
  const generatedFiles = readdirSync(path.join(PROJECT_ROOT, "content"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.(?:json|md)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
  for (const file of generatedFiles) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /field notes/i, file);
    assert.doesNotMatch(text, /motion[-_ ]?manifest/i, file);
  }
});

test("owner-only canonical bundle is ignored by Git", () => {
  const privateIgnore = readFileSync(
    path.join(PROJECT_ROOT, "content/private/.gitignore"),
    "utf8",
  );
  assert.match(privateIgnore, /(?:^|\n)\*(?:\n|$)/);
  assert.match(privateIgnore, /(?:^|\n)!\.gitignore(?:\n|$)/);
});
