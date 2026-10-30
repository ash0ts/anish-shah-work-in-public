import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { buildCopyDeck } from "../scripts/lib/copy-deck.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const [
  bundle,
  homeSource,
  introductionSource,
  bodySource,
  workGroupsSource,
  workPageSource,
  timelineSource,
  impactSource,
  impactEvidenceSource,
  impactEvidenceStyles,
  homePresentationSource,
  homePresentationManifest,
  homeIconsSource,
  packageJson,
] =
  await Promise.all([
  readFile(
    path.join(
      projectRoot,
      "content/public/anish-content.public.v1.json",
    ),
    "utf8",
  ).then(JSON.parse),
  readFile(path.join(projectRoot, "app/page.tsx"), "utf8"),
  readFile(
    path.join(projectRoot, "components/HomeIntroduction.tsx"),
    "utf8",
  ),
  readFile(
    path.join(projectRoot, "components/HomeWorkOverview.tsx"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "lib/work-groups.ts"), "utf8"),
  readFile(path.join(projectRoot, "app/work/page.tsx"), "utf8"),
  readFile(
    path.join(projectRoot, "app/work/WorkTimeline.tsx"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "lib/home-impact.ts"), "utf8"),
  readFile(
    path.join(projectRoot, "components/ImpactEvidence.tsx"),
    "utf8",
  ),
  readFile(
    path.join(projectRoot, "components/ImpactEvidence.module.css"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "lib/home-presentation.ts"), "utf8"),
  readFile(
    path.join(
      projectRoot,
      "content/presentation/home-overview.v2.json",
    ),
    "utf8",
  ).then(JSON.parse),
  readFile(
    path.join(projectRoot, "components/HomeVisualIcons.tsx"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "package.json"), "utf8").then(JSON.parse),
]);
const copyDeck = await buildCopyDeck(projectRoot);
const { homeWorkAreasFrom } = await tsImport(
  "../lib/home-presentation.ts",
  import.meta.url,
);

test("Home resolves every public WorkGroup into one of four lines", () => {
  assert.equal(bundle.schemaVersion, "1.2");
  assert.equal(bundle.workGroups.length, 88);
  const publicGroups = bundle.workGroups.filter(
    (group) => group.publicationState === "public",
  );
  assert.equal(publicGroups.length, 88);
  assert.deepEqual(
    Object.fromEntries(
      [
        "products-open-source",
        "courses-learning",
        "writing-research",
        "talks-programs",
      ].map((bucket) => [
        bucket,
        publicGroups.filter((group) => group.bucket === bucket).length,
      ]),
    ),
    {
      "products-open-source": 16,
      "courses-learning": 5,
      "writing-research": 23,
      "talks-programs": 44,
    },
  );
  assert(
    publicGroups.every((group) =>
      [
        "products-open-source",
        "courses-learning",
        "writing-research",
        "talks-programs",
      ].includes(group.bucket),
    ),
    "Every public WorkGroup must fold into exactly one visible body",
  );
});

test("Home uses one semantic illustrated overview with four filter entry points", () => {
  assert.match(homeSource, /areas=\{areas\}/);
  assert.match(introductionSource, /<HomeWorkOverview areas=/);
  assert.match(bodySource, /data-work-overview/);
  assert.match(bodySource, /areas\.map/);
  assert.match(bodySource, /href=\{area\.href\}/);
  assert.doesNotMatch(bodySource, /projectCount|topicCount|representative|group\.slug/);
  assert.doesNotMatch(bodySource, /<canvas|three|webgl/i);
});

test("overview entry points resolve the same visible archive, without exposed counts", async () => {
  const { workArchiveRecordsFrom } = await tsImport("../lib/work-index.ts", import.meta.url);
  const { filterWorkArchiveRecords, parseWorkArchiveQuery } = await tsImport("../lib/work-archive-query.ts", import.meta.url);
  const areas = homeWorkAreasFrom(bundle);
  assert.equal(areas.length, 4);
  for (const area of areas) {
    assert.deepEqual(Object.keys(area).sort(), ["href", "id", "illustrationId", "title"]);
    const query = parseWorkArchiveQuery(Object.fromEntries(new URL(area.href, "https://example.com").searchParams));
    const found = filterWorkArchiveRecords(workArchiveRecordsFrom(bundle), query);
    assert(found.length > 0);
    assert(found.every(record => record.bucket === area.id));
  }
  const hidden = structuredClone(bundle);
  const first = hidden.workGroups.find(group => group.bucket === areas[0].id);
  first.publicationState = "hidden";
  assert(!workArchiveRecordsFrom(hidden).some(record => record.id === first.id));
  for (const group of hidden.workGroups) {
    if (group.bucket === areas[0].id) group.publicationState = "hidden";
  }
  assert(!homeWorkAreasFrom(hidden).some(area => area.id === areas[0].id));
});

test("Home and Work share one expert-facing four-body taxonomy", () => {
  const bucketTitles = [1, 2, 3, 4].map(
    (index) => copyDeck.pages.work[`bucket-${index}-title`],
  );
  for (const label of [
    "Software & tools",
    "Courses & labs",
    "Research & writing",
    "Talks & programs",
  ]) {
    assert(bucketTitles.includes(label), label);
  }
  assert.match(workGroupsSource, /SITE_COPY\.work\["bucket-1-title"\]/u);
  assert.doesNotMatch(workGroupsSource, /title: "Products \/ Open Source"/);
  assert.doesNotMatch(workGroupsSource, /title: "Courses \/ Learning"/);
  assert.doesNotMatch(workGroupsSource, /title: "Writing \/ Research"/);
  assert.doesNotMatch(workGroupsSource, /title: "Talks \/ Programs"/);
  assert.doesNotMatch(workGroupsSource, /homepageWorkBuckets/);
  assert.deepEqual(
    homePresentationManifest.areas.map(({ bucketId }) => bucketId),
    [
      "products-open-source",
      "courses-learning",
      "writing-research",
      "talks-programs",
    ],
  );
});

test("Bodies of Work stays server-rendered and does not hydrate for decorative motion", () => {
  assert.doesNotMatch(bodySource, /"use client"/);
  assert.doesNotMatch(bodySource, /animejs|useLayoutEffect|IntersectionObserver/);
  assert.match(bodySource, /prefetch=\{false\}/);
});

test("Home keeps its LCP and introduction static without a client hydration boundary", () => {
  assert.doesNotMatch(introductionSource, /"use client"/);
  assert.doesNotMatch(introductionSource, /animejs|useLayoutEffect|useRef/);
  assert.doesNotMatch(introductionSource, /data-name-line/);
  assert.match(introductionSource, /prefetch=\{false\}/);
});

test("Work pairs flat filtered results with a semantic line-by-year color calendar", () => {
  assert.match(workPageSource, /workBuckets\.map/);
  assert.match(workPageSource, /data-work-line=\{bucket\.id\}/);
  assert.doesNotMatch(workPageSource, /data-work-body/);
  assert.match(workPageSource, /<WorkTimeline/);
  assert.doesNotMatch(
    workPageSource,
    /StoryTimeMatrix|WorkArchiveExplorer|WorkPlot/i,
  );
  assert.match(workPageSource, /paginateWorkArchiveRecords\(filtered, query\.page\)/);
  assert.match(workPageSource, /aria-label="Work result pages"/);
  assert.doesNotMatch(
    workPageSource,
    /from\s+["'](?:three|@react-three\/)|import\(["'](?:three|@react-three\/)/,
  );

  assert.match(
    timelineSource,
    /const years = \[2021, 2022, 2023, 2024, 2025, 2026\] as const/,
  );
  assert.match(timelineSource, /workBuckets\.flatMap/);
  assert.match(timelineSource, /years\.map/);
  assert.match(timelineSource, /<table>/);
  assert.match(timelineSource, /<thead>/);
  assert.match(timelineSource, /<tbody>/);
  assert.match(timelineSource, /scope="col"/);
  assert.match(timelineSource, /scope="row"/);
  assert.match(timelineSource, /data-bucket=\{bucket\.id\}/);
  assert.match(timelineSource, /data-year=\{year\}/);
  assert.match(timelineSource, /data-density=\{density \|\| undefined\}/);
  assert.match(timelineSource, /workArchiveHref\(query,/);
  assert.doesNotMatch(timelineSource, /formCount/);
  assert.match(timelineSource, /densityLevel\(/);
  assert.doesNotMatch(
    timelineSource,
    /@observablehq|canvas|three|webgl/i,
  );
  assert.equal(
    existsSync(path.join(projectRoot, "components/StoryTimeMatrix.tsx")),
    false,
  );
  assert.equal(
    existsSync(path.join(projectRoot, "app/work/WorkArchiveExplorer.tsx")),
    false,
  );
  assert.equal(
    existsSync(path.join(projectRoot, "app/work/WorkPlot.tsx")),
    false,
  );
  assert.equal(packageJson.dependencies["@observablehq/plot"], undefined);
});

test("Home signal circuit resolves three reviewed qualified metric IDs", () => {
  for (const metricId of [
    "metric:project:wandb-mcp-server:tool-calls:2026-10-22",
    "metric:courses:enrollments:2026-07-30",
    "metric:events:pipeline-supported:2024-2025",
  ]) {
    assert(
      homePresentationManifest.signals.some(
        (signal) => signal.metricId === metricId,
      ),
      metricId,
    );
  }
  assert.match(impactSource, /throw new Error/);
  assert.match(impactSource, /missing, unpublished, or assigned to the wrong theme/);
  assert.match(impactSource, /must be public and include its limit/);
  assert.doesNotMatch(impactSource, /proof-[123]-statement/);
  assert.match(impactEvidenceSource, /<figure/);
  assert.match(impactEvidenceSource, /data-signal-circuit/);
  assert.match(impactEvidenceSource, /<details/);
  assert.match(impactEvidenceSource, /name="home-signal"/);
  assert.match(impactEvidenceSource, /\/sources#internal-analytics/);
  assert.match(impactEvidenceSource, /`\/sources#\$\{datum\.metric\.id\}`/);
  assert.match(impactEvidenceSource, /track\.periodAsOf/);
  assert.match(impactSource, /periodAsOf: metric\.period\.asOf \?\? null/);
  assert.match(homeIconsSource, /function HomeSignalIcon/);
  assert.match(
    impactEvidenceStyles,
    /\.signals > li \{[\s\S]*--signal-accent: var\(--work-blue\)/,
  );
  assert.doesNotMatch(impactEvidenceStyles, /data-impact-track=/);
  assert.doesNotMatch(
    impactEvidenceSource,
    /What happened after the work shipped|Three independent measures/i,
  );
});

test("Home presentation mapping is closed, ordered, and rejects unreviewed changes", () => {
  assert.equal(homePresentationManifest.schemaVersion, "2.0");
  assert.deepEqual(
    homePresentationManifest.signals.map(
      ({ id, theme, iconId, compactLimit }) => ({
        id,
        theme,
        iconId,
        compactLimit,
      }),
    ),
    [
      {
        id: "deployed",
        theme: "product",
        iconId: "tool-interface",
        compactLimit: "Direct project usage · not revenue",
      },
      {
        id: "taught",
        theme: "learning",
        iconId: "open-book",
        compactLimit: "Enrollments · not unique learners",
      },
      {
        id: "programs",
        theme: "programs",
        iconId: "program-network",
        compactLimit: "Supported pipeline · not revenue",
      },
    ],
  );
  assert.equal(homePresentationManifest.areas.length, 4);
  assert.match(homePresentationSource, /home_signal_spec_unreviewed/);
  assert.match(homePresentationSource, /home_signal_order_invalid/);
  assert.match(homePresentationSource, /home_area_spec_unreviewed/);
});

test("the superseded chapter-stack and Three.js implementation is gone", () => {
  for (const file of [
    "components/HeroStage.tsx",
    "components/HeroStage.module.css",
  ]) {
    assert.equal(existsSync(path.join(projectRoot, file)), false, file);
  }
});
