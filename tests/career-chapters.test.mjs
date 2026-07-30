import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const [manifest, bundle, componentSource, componentCss, homeCss] =
  await Promise.all([
    readFile(
      path.join(
        projectRoot,
        "content/presentation/career-chapters.v1.json",
      ),
      "utf8",
    ).then(JSON.parse),
    readFile(
      path.join(
        projectRoot,
        "content/public/anish-content.public.v1.json",
      ),
      "utf8",
    ).then(JSON.parse),
    readFile(
      path.join(projectRoot, "components/CareerChapters.tsx"),
      "utf8",
    ),
    readFile(
      path.join(projectRoot, "components/CareerChapters.module.css"),
      "utf8",
    ),
    readFile(path.join(projectRoot, "app/home.module.css"), "utf8"),
  ]);

const expectedChapters = [
  {
    id: "operational-ml",
    workIds: ["entity:oc-fp-0001", "entity:wk-fp-0050"],
  },
  {
    id: "generative-systems",
    workIds: [
      "entity:wk-fp-0053",
      "entity:wk-fp-0055",
      "entity:oc-fp-0010",
    ],
  },
  {
    id: "evaluation-loop",
    workIds: [
      "entity:pg-0002",
      "entity:wk-0002",
      "entity:oc-fp-0076",
    ],
  },
  {
    id: "agents-adoption",
    workIds: [
      "entity:wk-fp-0066",
      "entity:pg-0001",
      "entity:oc-fp-0045",
    ],
  },
  {
    id: "agent-native-product",
    workIds: ["entity:wk-0001"],
  },
];

test("Career Chapters has the approved five-period, twelve-anchor contract", () => {
  assert.equal(manifest.schemaVersion, "1.0");
  assert.deepEqual(
    manifest.chapters.map(({ id, workIds }) => ({ id, workIds })),
    expectedChapters,
  );

  const workIds = manifest.chapters.flatMap((chapter) => chapter.workIds);
  assert.equal(workIds.length, 12);
  assert.equal(new Set(workIds).size, 12);
  assert.equal(Object.keys(manifest.workLabels).length, 12);
});

test("every chapter anchor resolves to a public canonical entity and label", () => {
  const entities = new Map(bundle.entities.map((entity) => [entity.id, entity]));
  for (const chapter of manifest.chapters) {
    assert(chapter.period.trim());
    assert(chapter.title.trim());
    assert(chapter.statement.trim());
    for (const workId of chapter.workIds) {
      const entity = entities.get(workId);
      assert(entity, `${workId} is missing from the sanitized bundle`);
      assert.equal(entity.publicationState, "public");
      assert(entity.slug);
      assert(entity.itemIds.length > 0);
      assert(manifest.workLabels[workId]?.trim());
    }
  }
});

test("chapter counts, disclosure state, and WebGL failure cleanup remain resilient", () => {
  assert.match(componentSource, /const chapterCount = chapters\.length/);
  assert.match(componentSource, /const anchorCount = chapters\.reduce/);
  assert.doesNotMatch(componentSource, /five turns|Twelve anchors/);

  assert.match(componentCss, /\.chapter\[open\] summary/);
  assert.match(componentCss, /\.chapter\[open\] summary > i::before/);
  assert.doesNotMatch(componentCss, /\[data-selected="true"\] summary/);

  assert.match(
    componentSource,
    /catch\s*\{\s*disposeScene\(\);\s*if \(!disposed\) setSceneMode\("unavailable"\)/,
  );
  assert.match(componentSource, /host\.removeChild\(renderer\.domElement\)/);
  assert.match(componentCss, /\.panel a > span[\s\S]*?font-size: 0\.55rem/);
  assert.match(homeCss, /\.metricList span[\s\S]*?font-size: 0\.55rem/);
});
