import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
    path.join(projectRoot, "components/BodiesOfWork.tsx"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "lib/work-groups.ts"), "utf8"),
  readFile(path.join(projectRoot, "app/work/page.tsx"), "utf8"),
  readFile(
    path.join(projectRoot, "app/work/WorkTimeline.tsx"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "package.json"), "utf8").then(JSON.parse),
]);

const expectedFeatured = {
  "products-open-source": [
    "group:products:wandb-mcp",
    "group:products:evalforge",
    "group:products:lightning-fabric",
  ],
  "courses-learning": [
    "group:courses:ai-curriculum",
    "group:courses:agentic-llm-series",
    "group:courses:startup-school",
  ],
  "writing-research": [
    "group:writing:wandbot",
    "group:writing:prompt-engineering-langchain",
    "group:writing:automated-pdf-summarization",
  ],
  "talks-programs": [
    "group:talks:architecting-agents",
    "group:talks:llm-agent-fine-tuning",
    "group:talks:building-evaluating-agents",
  ],
};

test("Bodies of Work resolves four parallel buckets with three featured stories each", () => {
  assert.equal(bundle.schemaVersion, "1.2");
  assert.equal(bundle.workGroups.length, 82);
  const publicGroups = bundle.workGroups.filter(
    (group) => group.publicationState === "public",
  );
  assert.equal(publicGroups.length, 82);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(expectedFeatured).map((bucket) => [
        bucket,
        publicGroups.filter((group) => group.bucket === bucket).length,
      ]),
    ),
    {
      "products-open-source": 14,
      "courses-learning": 3,
      "writing-research": 22,
      "talks-programs": 43,
    },
  );
  assert(
    publicGroups.every((group) =>
      Object.hasOwn(expectedFeatured, group.bucket),
    ),
    "Every public WorkGroup must fold into exactly one visible body",
  );

  for (const [bucket, expectedIds] of Object.entries(expectedFeatured)) {
    const featured = publicGroups
      .filter((group) => group.bucket === bucket)
      .filter((group) => group.featuredOrder !== null)
      .sort((left, right) => left.featuredOrder - right.featuredOrder);
    assert.deepEqual(featured.map((group) => group.id), expectedIds);
    assert.equal(featured.length, 3);
  }
});

test("Home is semantic HTML with one expanded bucket and no numbered decoration", () => {
  assert.match(homeSource, /<HomeIntroduction/);
  assert.match(homeSource, /<BodiesOfWork/);
  assert.match(bodySource, /<details/);
  assert.match(bodySource, /open=\{index === 0\}/);
  assert.match(
    bodySource,
    /Systems, curricula, writing, and technical sessions\./,
  );
  assert.match(bodySource, /group\.homeTitle/);
  assert.match(bodySource, /group\.homeRole/);
  assert.match(bodySource, /bucket\.groups\.map/);
  assert.doesNotMatch(bodySource, /bucket\.number|padStart/);
  assert.doesNotMatch(bodySource, /canvas|three|webgl/i);
});

test("Home and Work share one expert-facing four-body taxonomy", () => {
  for (const label of [
    "Systems & Open Source",
    "Curricula & Workshops",
    "Technical Writing & Implementations",
    "Technical Talks & Programs",
  ]) {
    assert(workGroupsSource.includes(label), label);
  }
  for (const title of [
    "W&B MCP Server",
    "EvalForge: evaluation-criteria generation & alignment",
    "W&B logging & checkpointing for Lightning Fabric",
    "AI curriculum: prompting, evaluation & agents",
    "Agentic LLM fine-tuning & evaluation",
    "Google Cloud Startup School: GenAI applications",
    "WandBot: GPT-4 documentation support",
    "Prompt engineering with LangChain & W&B",
    "arXiv summarization with Claude & Weave",
    "Architecting & orchestrating AI agents",
    "LLM agent fine-tuning for task automation",
    "Building agents with evaluation in the loop",
  ]) {
    assert(workGroupsSource.includes(title), title);
  }
  assert.doesNotMatch(workGroupsSource, /title: "Products \/ Open Source"/);
  assert.doesNotMatch(workGroupsSource, /title: "Courses \/ Learning"/);
  assert.doesNotMatch(workGroupsSource, /title: "Writing \/ Research"/);
  assert.doesNotMatch(workGroupsSource, /title: "Talks \/ Programs"/);
  assert.doesNotMatch(workGroupsSource, /homepageWorkBuckets/);
  assert.match(workGroupsSource, /return workBuckets\.map/);
});

test("Bodies of Work motion enhances native details without hiding SSR content", () => {
  assert.match(bodySource, /import \{ animate, stagger \} from "animejs"/);
  assert.match(bodySource, /useLayoutEffect/);
  assert.match(bodySource, /addEventListener\("toggle", onToggle\)/);
  assert.match(bodySource, /animation\.cancel\(\)/);
  assert.match(bodySource, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(bodySource, /opacity:\s*\[0,\s*1\]/);
});

test("Home keeps its LCP name static while non-LCP motion remains cancellable", () => {
  assert.match(introductionSource, /import \{ animate \} from "animejs"/);
  assert.match(introductionSource, /useLayoutEffect/);
  assert.match(introductionSource, /animation\.cancel\(\)/);
  assert.match(introductionSource, /prefers-reduced-motion: reduce/);
  assert.match(introductionSource, /const copy = root\.querySelector/);
  assert.match(introductionSource, /animate\(copy,/);
  assert.doesNotMatch(introductionSource, /data-name-line/);
  assert.doesNotMatch(introductionSource, /querySelectorAll\([^)]*name/i);
  assert.doesNotMatch(introductionSource, /import\("animejs"\)/);
  assert.doesNotMatch(introductionSource, /opacity:\s*\[0,\s*1\]/);
});

test("Work pairs its four-body SSR index with a semantic body-by-year color calendar", () => {
  assert.match(workPageSource, /workBuckets\.map/);
  assert.match(workPageSource, /data-work-body=\{bucket\.id\}/);
  assert.match(workPageSource, /<WorkTimeline/);
  assert.doesNotMatch(
    workPageSource,
    /StoryTimeMatrix|WorkArchiveExplorer|WorkPlot|pagination/i,
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
  assert.match(timelineSource, /formCount/);
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
  assert.equal(packageJson.dependencies.three, undefined);
});

test("the superseded chapter-stack and Three.js implementation is gone", () => {
  for (const file of [
    "components/HeroStage.tsx",
    "components/HeroStage.module.css",
  ]) {
    assert.equal(existsSync(path.join(projectRoot, file)), false, file);
  }
});
