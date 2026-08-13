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
  paginateWorkArchiveRecords,
  parseWorkArchiveQuery,
  WORK_ARCHIVE_PAGE_SIZE,
  workArchiveHref,
  workResultHeading,
} = await tsImport("../lib/work-archive-query.ts", import.meta.url);
const { workArchiveRecordsFrom } = await tsImport(
  "../lib/work-index.ts",
  import.meta.url,
);
const { applyCopyDeckToBundle } = await tsImport(
  "../lib/copy.ts",
  import.meta.url,
);
const { workBuckets } = await tsImport(
  "../lib/work-groups.ts",
  import.meta.url,
);
const { workMetadataDescription } = await tsImport(
  "../lib/seo.ts",
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
const copyAppliedRecords = workArchiveRecordsFrom(
  applyCopyDeckToBundle(publicBundle),
);

test("filtered headings describe the active line and presentation topic", () => {
  const heading = (params, overrides = {}) =>
    workResultHeading({
      bucketTitle: null,
      defaultHeading: "Project index",
      filteredHeading: "Filtered projects",
      organizationName: null,
      query: parseWorkArchiveQuery(params),
      topicLabel: null,
      ...overrides,
    });

  assert.equal(
    heading(
      { bucket: "products-open-source" },
      { bucketTitle: "Agent systems & open source" },
    ),
    "Agent systems & open source",
  );
  assert.equal(
    heading(
      { topic: "agent-systems" },
      { topicLabel: "Agent systems" },
    ),
    "Agent systems projects",
  );
  assert.equal(
    heading(
      { bucket: "products-open-source", topic: "agent-systems" },
      {
        bucketTitle: "Agent systems & open source",
        topicLabel: "Agent systems",
      },
    ),
    "Agent systems · Agent systems & open source",
  );
});

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

test("archive rows expose the curated short title independently of the detail title", () => {
  const groups = new Map(
    applyCopyDeckToBundle(publicBundle).workGroups.map((group) => [
      group.id,
      group,
    ]),
  );

  assert(
    copyAppliedRecords.every(
      (record) => record.shortTitle === groups.get(record.id)?.shortTitle,
    ),
  );

  const fugue = copyAppliedRecords.find(
    (record) => record.id === "group:standalone:wk-fp-0161",
  );
  assert(fugue);
  assert.equal(fugue.title, "Fugue: governed experiments for AI agents");
  assert.equal(fugue.shortTitle, "Fugue agent experiments");
});

test("Work metadata expands concise summaries and stays within the public SEO budget", () => {
  const concise =
    "An MCP interface lets agents inspect W&B experiments and traces.";
  const expanded = workMetadataDescription("W&B MCP Server", concise);
  assert.equal(
    expanded,
    `${concise} This page documents the role, public artifacts, and supporting sources.`,
  );
  assert(expanded.length >= 80 && expanded.length <= 160);

  const placeholder = workMetadataDescription("Example", "Contributor.");
  assert.match(placeholder, /^Explore Anish Shah’s work on Example,/u);
  assert(placeholder.length >= 80 && placeholder.length <= 160);

  const longSummary = "A".repeat(200);
  const bounded = workMetadataDescription("Example", longSummary);
  assert.equal(
    bounded,
    "Explore Anish Shah’s work on Example, including its documented role, public artifacts, and supporting sources.",
  );
  assert(bounded.length >= 80 && bounded.length <= 160);

  for (const record of copyAppliedRecords) {
    const description = workMetadataDescription(record.title, record.summary);
    assert(
      description.length >= 80 && description.length <= 160,
      `${record.slug} metadata description is ${description.length} characters`,
    );
  }
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

test("the archive paginates exactly 24 canonical works while preserving order", () => {
  assert.equal(WORK_ARCHIVE_PAGE_SIZE, 24);
  const first = paginateWorkArchiveRecords(records, 1);
  const second = paginateWorkArchiveRecords(records, 2);
  const last = paginateWorkArchiveRecords(records, 999);

  assert.equal(first.items.length, 24);
  assert.equal(second.items.length, 24);
  assert.equal(first.rangeStart, 1);
  assert.equal(first.rangeEnd, 24);
  assert.equal(second.rangeStart, 25);
  assert.equal(second.rangeEnd, 48);
  assert.deepEqual(
    [...first.items, ...second.items].map((record) => record.id),
    records.slice(0, 48).map((record) => record.id),
  );
  assert.equal(last.currentPage, Math.ceil(records.length / 24));
  assert.equal(last.rangeEnd, records.length);
});

test("the color calendar has four semantic rows, six years, and exact archive counts", () => {
  const years = [2021, 2022, 2023, 2024, 2025, 2026];
  const expected = {
    "products-open-source": [0, 1, 4, 4, 2, 3],
    "courses-learning": [0, 0, 0, 2, 2, 0],
    "writing-research": [1, 4, 9, 7, 0, 1],
    "talks-programs": [1, 2, 10, 19, 11, 1],
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
          return works.length;
        }),
      ]),
    ),
    expected,
  );

  const maximum = Math.max(
    ...Object.values(expected).flatMap((row) =>
      row,
    ),
  );
  assert.equal(maximum, 19);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(expected).map(([bucket, row]) => [
        bucket,
        row.map((workCount) => densityLevel(workCount, maximum)),
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

test("Work source renders a paginated four-line index and semantic color calendar", async () => {
  const [
    source,
    timeline,
    timelineControls,
    mobileFilters,
    css,
    timelineCss,
    detailSource,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../app/work/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/work/WorkTimeline.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/work/WorkTimelineControls.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/work/WorkMobileFilters.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/work/work.module.css", import.meta.url), "utf8"),
    readFile(
      new URL("../app/work/WorkTimeline.module.css", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/work/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.match(source, /workBuckets\.map/);
  assert.match(source, /data-work-line=\{bucket\.id\}/);
  assert.doesNotMatch(source, /data-work-body|<details[\s\S]{0,200}styles\.body/);
  assert.match(source, /<ActiveScope/);
  assert.match(source, /Remove \$\{filter\.label\} \$\{filter\.key\} filter/);
  assert.match(source, />Change filters</);
  assert.match(source, /<WorkTimeline query=\{query\} records=\{timelineRecords\}/);
  assert.match(source, /countWorkFacetOptions\(allWorks, "theme"\)/);
  assert.match(source, /countWorkFacetOptions\(allWorks, "media"\)/);
  assert.doesNotMatch(source, /countWorkFacetOptions\(allWorks, "ecosystem"\)/);
  assert.doesNotMatch(source, /countWorkFacetOptions\(allWorks, "contribution"\)/);
  assert.doesNotMatch(
    source,
    /StoryTimeMatrix|WorkArchiveExplorer|WorkPlot/i,
  );
  assert.match(source, /paginateWorkArchiveRecords\(filtered, query\.page\)/);
  assert.match(source, /page\.items\.filter/);
  assert.match(source, /<WorkPagination/);
  assert.match(source, /workArchiveHref\(query, \{ page:/);
  assert.doesNotMatch(
    source,
    /from\s+["'](?:three|@react-three\/)|import\(["'](?:three|@react-three\/)/,
  );
  for (const name of ["bucket", "topic", "year", "format"]) {
    assert.match(source, new RegExp(`<FilterSelect[\\s\\S]{0,240}name="${name}"`));
  }
  assert.doesNotMatch(
    source,
    /<FilterSelect[\s\S]{0,240}name="(?:organization|role)"/,
  );
  assert.match(source, /<input name="organization" type="hidden"/);
  assert.match(source, /<input name="role" type="hidden"/);
  assert.match(
    source,
    /<details[\s\S]{0,180}className=\{styles\.moreFilters\}[\s\S]{0,180}id="work-more-filters"[\s\S]*?name="format"/,
  );
  assert.equal(WORK_ARCHIVE_PAGE_SIZE, 24);
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
  assert.match(timeline, /data-timeline-year=\{year\}/);
  assert.match(timeline, /<WorkTimelineControls/);
  assert.match(timeline, /availableYears\.at\(-1\)/);
  assert.match(timeline, /workArchiveHref\(query,/);
  assert.match(timeline, /\}\#work-index`/);
  assert.match(timeline, /works\.length/);
  assert.doesNotMatch(timeline, /formCount/);
  assert.match(timeline, /densityLevel\(/);
  assert.match(timeline, /Math\.ceil\(Math\.sqrt\(count \/ maximum\) \* 5\)/);
  assert.doesNotMatch(timeline, /@observablehq|canvas|three|webgl/i);
  assert.equal(packageJson.dependencies["@observablehq/plot"], undefined);

  assert.match(timelineControls, /setMobileYearPresentation/);
  assert.match(timelineControls, /restoreFullCalendar/);
  assert.match(timelineControls, /cell\.hidden = cellYear !== year/);
  assert.match(timelineControls, /prefers-reduced-motion: reduce/);
  assert.match(timelineControls, /aria-pressed=\{selectedYear === year\}/);
  assert.match(timelineCss, /scroll-snap-type:\s*inline mandatory/);
  assert.match(timelineCss, /width:\s*calc\(100vw - 7\.25rem\)/);
  assert.match(
    timelineCss,
    /\.frame\[data-mobile-year\]\s*\{[\s\S]*?overflow-x:\s*hidden/,
  );
  assert.match(
    timelineCss,
    /\.frame\[data-mobile-year\] table\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0/,
  );

  assert.match(mobileFilters, /HTMLDialogElement\.prototype\.showModal/);
  assert.match(mobileFilters, /<dialog/);
  assert.match(mobileFilters, /action="\/work#work-index"/);
  assert.match(mobileFilters, /triggerRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(mobileFilters, /name="(?:bucket|topic|year)"[\s\S]{0,120}<select/);
  assert.match(source, /allLabel="All lines"[\s\S]*label="Line of work"[\s\S]*name="bucket"/);
  assert.match(source, /allLabel="All years"[\s\S]*label="Year"[\s\S]*name="year"/);
  assert.match(source, /allLabel="All topics"[\s\S]*label="Topic"[\s\S]*name="topic"/);
  assert.match(css, /\.mobileFilterDialog::backdrop/);
  assert.match(detailSource, /<dl className=\{styles\.facts\}/);
  assert.match(detailSource, /<dt>\{label\}<\/dt>/);
  assert.match(detailSource, /href=\{bucketHref\}/);
  assert.match(detailSource, /workThemeFacetLabel\(topic\)/);
  assert.match(detailSource, /<PublicArtifactLink item=\{primary\} primary \/>/);

  assert.match(
    source,
    /id="work-more-filters"[\s\S]{0,100}open=\{Boolean\(query\.format\)\}/,
    "Format should open server-side when that filter is active",
  );
  assert.doesNotMatch(source, /WorkFilterBehavior/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
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
  assert.match(sitemapSource, /`\$\{baseUrl\}\/about/);
  assert.match(sitemapSource, /workArchiveRecordsFrom\(bundle\)/);
});
