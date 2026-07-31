import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import publicBundle from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};

const {
  filterWorkArchiveRecords,
  legacyMapRedirectPath,
  matchingChildForQuery,
  parseWorkArchiveQuery,
  workArchiveHref,
} = await tsImport("../lib/work-archive-query.ts", import.meta.url);
const { workArchiveRecordsFrom } = await tsImport(
  "../lib/work-index.ts",
  import.meta.url,
);
const { workBuckets } = await tsImport(
  "../lib/work-groups.ts",
  import.meta.url,
);
const {
  contributionFacetDefinitions,
  ecosystemFacetDefinitions,
  mediaFacetDefinitions,
  themeFacetDefinitions,
  workFacetsForRecord,
} = await tsImport("../lib/work-facets.ts", import.meta.url);

const records = workArchiveRecordsFrom(publicBundle);

test("the archive indexes public WorkGroups while keeping context-only observations nested", () => {
  const publicItems = publicBundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const nestedItemIds = new Set(
    publicBundle.workGroups.flatMap((group) => group.itemIds),
  );
  const residual = publicItems.filter((item) => !nestedItemIds.has(item.id));

  assert.equal(records.length, 82);
  assert.deepEqual(
    new Set(records.map((record) => record.id)),
    new Set(publicBundle.workGroups.map((group) => group.id)),
  );
  assert.equal(nestedItemIds.size, 157);
  assert.equal(residual.length, 29);
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(residual.map((item) => item.type))]
        .sort()
        .map((type) => [
          type,
          residual.filter((item) => item.type === type).length,
        ]),
    ),
    {
      external_reference: 23,
      profile: 6,
    },
  );
});

test("related context is searchable when it has an explicit group relationship", () => {
  const odscReference = publicBundle.items.find(
    (item) => item.id === "item:fp-0100",
  );
  const unassociatedProfile = publicBundle.items.find(
    (item) => item.id === "item:fp-0101",
  );
  assert(odscReference && unassociatedProfile);

  const odscResults = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({ q: odscReference.displayTitle }),
  );
  assert.deepEqual(
    odscResults.map((record) => record.id),
    ["group:standalone:oc-fp-0002"],
  );
  assert.equal(
    matchingChildForQuery(odscResults[0], odscReference.displayTitle)?.id,
    odscReference.id,
  );

  const profileResults = filterWorkArchiveRecords(
    records,
    parseWorkArchiveQuery({ q: unassociatedProfile.displayTitle }),
  );
  assert.deepEqual(profileResults, []);
});

test("bucket, topic, and legacy practice filters operate on WorkGroups", () => {
  const sample = records.find((record) => record.topics.length);
  assert(sample, "Expected at least one canonical work with a topic");

  const topicQuery = parseWorkArchiveQuery({ topic: sample.topics[0] });
  const topicResults = filterWorkArchiveRecords(records, topicQuery);
  assert(topicResults.length > 0);
  assert(
    topicResults.every((record) => record.topics.includes(sample.topics[0])),
  );

  const bucketQuery = parseWorkArchiveQuery({ bucket: sample.bucket });
  assert(
    filterWorkArchiveRecords(records, bucketQuery).every(
      (record) => record.bucket === sample.bucket,
    ),
  );

  const legacyQuery = parseWorkArchiveQuery({ practice: sample.practice });
  assert(
    filterWorkArchiveRecords(records, legacyQuery).every(
      (record) => record.practice === sample.practice,
    ),
  );
});

test("compact presentation facets filter the canonical archive without rewriting source metadata", () => {
  assert.deepEqual(
    [
      themeFacetDefinitions.length,
      mediaFacetDefinitions.length,
      ecosystemFacetDefinitions.length,
      contributionFacetDefinitions.length,
    ],
    [8, 5, 9, 6],
  );

  const cases = [
    {
      dimension: "theme",
      parameter: "topic",
      value: "agent-systems",
    },
    {
      dimension: "media",
      parameter: "format",
      value: "software",
    },
    {
      dimension: "ecosystem",
      parameter: "organization",
      value: "weights-biases",
    },
    {
      dimension: "contribution",
      parameter: "role",
      value: "builder-contributor",
    },
  ];

  for (const { dimension, parameter, value } of cases) {
    const sample = records.find((record) => {
      const facet = workFacetsForRecord(record)[dimension];
      return Array.isArray(facet) ? facet.includes(value) : facet === value;
    });
    assert(sample, `Expected a work in ${dimension}:${value}`);

    const results = filterWorkArchiveRecords(
      records,
      parseWorkArchiveQuery({ [parameter]: value }),
    );
    assert(
      results.some((record) => record.id === sample.id),
      `${parameter}=${value} did not return ${sample.id}`,
    );
    assert(
      results.every((record) => {
        const facet = workFacetsForRecord(record)[dimension];
        return Array.isArray(facet)
          ? facet.includes(value)
          : facet === value;
      }),
      `${parameter}=${value} returned a work outside the derived facet`,
    );
  }
});

test("child-title search returns its canonical work and identifies the matched form", () => {
  const match = records
    .flatMap((record) =>
      record.childItems.map((child) => ({ record, child })),
    )
    .find(
      ({ record, child }) =>
        matchingChildForQuery(record, child.displayTitle)?.id === child.id,
    );
  assert(match, "Expected one child title that is distinct from its parent");

  const query = parseWorkArchiveQuery({ q: match.child.displayTitle });
  const results = filterWorkArchiveRecords(records, query);
  assert(results.some((record) => record.id === match.record.id));
  assert.equal(
    matchingChildForQuery(match.record, query.query)?.id,
    match.child.id,
  );
});

test("every child slug and alias identifies and anchors its canonical form", () => {
  for (const record of records) {
    for (const child of record.childItems) {
      for (const candidate of [child.slug, ...child.aliases]) {
        const query = parseWorkArchiveQuery({ q: candidate });
        assert(
          filterWorkArchiveRecords(records, query).some(
            (result) => result.id === record.id,
          ),
          `${candidate} did not return ${record.id}`,
        );
        assert.equal(
          matchingChildForQuery(record, candidate)?.id,
          child.id,
          `${candidate} did not identify ${child.id}`,
        );
      }
    }
  }
});

test("legacy map URLs canonicalize without losing search filters", () => {
  const redirected = legacyMapRedirectPath({
    view: "map",
    q: "agents",
    bucket: "talks-programs",
    topic: "agents",
    year: "2025",
    format: "event",
    organization: "org:wandb",
    role: "Speaker",
    practice: "convene",
    page: "2",
  });
  assert(redirected);
  const url = new URL(redirected, "https://example.test");
  assert.equal(url.pathname, "/work");
  assert.equal(url.searchParams.has("view"), false);
  assert.equal(url.searchParams.get("q"), "agents");
  assert.equal(url.searchParams.get("bucket"), "talks-programs");
  assert.equal(url.searchParams.get("topic"), "agents");
  assert.equal(url.searchParams.get("year"), "2025");
  assert.equal(url.searchParams.get("format"), "event");
  assert.equal(url.searchParams.get("organization"), "org:wandb");
  assert.equal(url.searchParams.get("role"), "Speaker");
  assert.equal(url.searchParams.get("practice"), "convene");
  assert.equal(url.searchParams.get("page"), "2");
});

test("generated archive links never reintroduce the removed view parameter", () => {
  const query = parseWorkArchiveQuery({
    q: "MCP",
    topic: "agents",
    page: "3",
  });
  const href = workArchiveHref(query, { page: 2 });
  const url = new URL(href, "https://example.test");
  assert.equal(url.searchParams.get("q"), "MCP");
  assert.equal(url.searchParams.get("topic"), "agents");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.has("view"), false);
});

test("the color calendar has four semantic rows, six years, and exact archive counts", () => {
  const years = [2021, 2022, 2023, 2024, 2025, 2026];
  const expected = {
    "products-open-source": [
      [0, 0],
      [1, 2],
      [4, 7],
      [4, 6],
      [2, 2],
      [3, 4],
    ],
    "courses-learning": [
      [0, 0],
      [0, 0],
      [0, 0],
      [2, 10],
      [2, 10],
      [0, 0],
    ],
    "writing-research": [
      [1, 1],
      [4, 6],
      [9, 14],
      [7, 14],
      [0, 0],
      [1, 1],
    ],
    "talks-programs": [
      [1, 2],
      [2, 10],
      [10, 20],
      [19, 37],
      [11, 23],
      [1, 1],
    ],
  };

  assert.equal(workBuckets.length, 4);
  assert.equal(years.length, 6);
  assert.deepEqual(
    Object.fromEntries(
      workBuckets.map((bucket) => [
        bucket.id,
        years.map((year) => {
          const works = records
            .filter((record) => record.bucket === bucket.id)
            .filter((record) => activeInYear(record, year));
          return [
            works.length,
            works.reduce((count, work) => count + work.formCount, 0),
          ];
        }),
      ]),
    ),
    expected,
  );

  const maximum = Math.max(
    ...Object.values(expected).flatMap((row) =>
      row.map(([workCount]) => workCount),
    ),
  );
  assert.equal(maximum, 19);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(expected).map(([bucket, row]) => [
        bucket,
        row.map(([workCount]) => densityLevel(workCount, maximum)),
      ]),
    ),
    {
      "products-open-source": [0, 2, 3, 3, 2, 2],
      "courses-learning": [0, 0, 0, 2, 2, 0],
      "writing-research": [2, 3, 4, 4, 0, 2],
      "talks-programs": [2, 2, 4, 5, 4, 2],
    },
  );
});

test("timeline cell links preserve active query filters while selecting body and year", () => {
  const query = parseWorkArchiveQuery({
    q: "agents",
    bucket: "writing-research",
    topic: "agent-systems",
    year: "2023",
    format: "live-session",
    organization: "weights-biases",
    role: "speaker-presenter",
    page: "3",
  });
  const href = workArchiveHref(query, {
    bucket: "talks-programs",
    page: null,
    year: 2025,
  });
  const url = new URL(href, "https://example.test");

  assert.equal(url.pathname, "/work");
  assert.equal(url.searchParams.get("q"), "agents");
  assert.equal(url.searchParams.get("bucket"), "talks-programs");
  assert.equal(url.searchParams.get("topic"), "agent-systems");
  assert.equal(url.searchParams.get("year"), "2025");
  assert.equal(url.searchParams.get("format"), "live-session");
  assert.equal(url.searchParams.get("organization"), "weights-biases");
  assert.equal(url.searchParams.get("role"), "speaker-presenter");
  assert.equal(url.searchParams.has("page"), false);
});

test("Work source renders four body folds and a semantic server-rendered color calendar", async () => {
  const [source, timeline, behavior, css, packageJson] = await Promise.all([
    readFile(new URL("../app/work/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/work/WorkTimeline.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/work/WorkFilterBehavior.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/work/work.module.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.match(source, /workBuckets\.map/);
  assert.match(source, /data-work-body=\{bucket\.id\}/);
  assert.match(source, /<WorkTimeline query=\{query\} records=\{timelineRecords\}/);
  assert.match(source, /countWorkFacetOptions\(allWorks, "theme"\)/);
  assert.match(source, /countWorkFacetOptions\(allWorks, "media"\)/);
  assert.match(source, /countWorkFacetOptions\(allWorks, "ecosystem"\)/);
  assert.match(source, /countWorkFacetOptions\(allWorks, "contribution"\)/);
  assert.doesNotMatch(
    source,
    /StoryTimeMatrix|WorkArchiveExplorer|WorkPlot|const perPage|pagination/i,
  );
  for (const name of [
    "bucket",
    "topic",
    "year",
    "format",
    "organization",
    "role",
  ]) {
    assert.match(source, new RegExp(`name="${name}"`));
  }
  assert.doesNotMatch(source, /name="view"/);

  assert.match(
    timeline,
    /const years = \[2021, 2022, 2023, 2024, 2025, 2026\] as const/,
  );
  assert.match(timeline, /workBuckets\.flatMap/);
  assert.match(timeline, /years\.map/);
  assert.match(timeline, /<table>/);
  assert.match(timeline, /scope="col"/);
  assert.match(timeline, /scope="row"/);
  assert.match(timeline, /data-bucket=\{bucket\.id\}/);
  assert.match(timeline, /data-year=\{year\}/);
  assert.match(timeline, /data-density=\{density \|\| undefined\}/);
  assert.match(timeline, /workArchiveHref\(query,/);
  assert.match(timeline, /\}\#work-index`/);
  assert.match(timeline, /works\.length/);
  assert.match(timeline, /formCount/);
  assert.match(timeline, /densityLevel\(/);
  assert.match(timeline, /Math\.ceil\(Math\.sqrt\(count \/ maximum\) \* 5\)/);
  assert.doesNotMatch(timeline, /@observablehq|canvas|three|webgl/i);
  assert.equal(packageJson.dependencies["@observablehq/plot"], undefined);
  assert.equal(packageJson.dependencies.three, undefined);

  assert.doesNotMatch(
    source,
    /id="work-(?:more-)?filters"[\s\S]{0,80}\bopen\b/,
    "Filter disclosures must not SSR open and collapse after paint",
  );
  assert.match(behavior, /min-width:\s*1101px/);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)/);
  assert.match(
    css,
    /\.moreFilters:not\(\[open\]\)\s*>\s*\.secondaryFilters\s*\{[\s\S]*?display:\s*none/,
  );
});

function activeInYear(record, year) {
  const start = record.yearStart ?? record.yearEnd;
  const end = record.yearEnd ?? record.yearStart;
  return start !== null && end !== null && year >= start && year <= end;
}

function densityLevel(count, maximum) {
  if (!count) return 0;
  return Math.max(
    1,
    Math.min(5, Math.ceil(Math.sqrt(count / maximum) * 5)),
  );
}

test("robots and sitemap source exclude owner and API surfaces", async () => {
  const [robotsSource, sitemapSource] = await Promise.all([
    readFile(new URL("../app/robots.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
  ]);
  assert.match(robotsSource, /"\/studio"/);
  assert.match(robotsSource, /"\/api\/"/);
  assert.doesNotMatch(sitemapSource, /`\$\{baseUrl\}\/(?:studio|api)/);
  assert.match(sitemapSource, /workArchiveRecordsFrom\(bundle\)/);
});
