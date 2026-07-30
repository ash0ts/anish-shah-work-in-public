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

const records = workArchiveRecordsFrom(publicBundle);

test("the archive separates nested forms from context and supplemental observations", () => {
  const publicItems = publicBundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const indexedEntityIds = new Set(records.map((record) => record.id));
  const indexedEntities = publicBundle.entities.filter((entity) =>
    indexedEntityIds.has(entity.id),
  );
  const nestedItemIds = new Set(
    indexedEntities.flatMap((entity) => entity.itemIds),
  );
  const residual = publicItems.filter((item) => !nestedItemIds.has(item.id));
  const entityById = new Map(
    publicBundle.entities.map((entity) => [entity.id, entity]),
  );

  assert.equal(records.length, 99);
  assert.equal(nestedItemIds.size, 156);
  assert.equal(residual.length, 30);
  assert(
    residual.every((item) => {
      const entity = entityById.get(item.canonicalEntityId);
      return (
        entity?.countability === "context" ||
        entity?.sourceBasis === "supplemental"
      );
    }),
    "Residual observations must stay explicitly contextual or supplemental",
  );
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
      open_source_repo: 1,
      profile: 6,
    },
  );
});

test("topic and legacy practice filters operate on canonical works", () => {
  const sample = records.find((record) => record.topics.length);
  assert(sample, "Expected at least one canonical work with a topic");

  const topicQuery = parseWorkArchiveQuery({ topic: sample.topics[0] });
  const topicResults = filterWorkArchiveRecords(records, topicQuery);
  assert(topicResults.length > 0);
  assert(
    topicResults.every((record) => record.topics.includes(sample.topics[0])),
  );

  const legacyQuery = parseWorkArchiveQuery({ practice: sample.practice });
  assert(
    filterWorkArchiveRecords(records, legacyQuery).every(
      (record) => record.practice === sample.practice,
    ),
  );
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

test("Work source removes map and all-forms UI while retaining 24-item pagination", async () => {
  const [source, behavior, css] = await Promise.all([
    readFile(new URL("../app/work/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/work/WorkFilterBehavior.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/work/work.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /const perPage = 24/);
  assert.doesNotMatch(source, /VisualArchive|view switch|Browse all/i);
  assert.match(source, /name="topic"/);
  assert.doesNotMatch(source, /name="view"/);
  assert.doesNotMatch(
    source,
    /id="work-(?:more-)?filters"[\s\S]{0,80}\bopen\b/,
    "Filter disclosures must not SSR open and collapse after paint",
  );
  assert.match(behavior, /min-width:\s*901px/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(
    css,
    /\.moreFilters:not\(\[open\]\)\s*>\s*\.secondaryFilters\s*\{[\s\S]*?display:\s*none/,
  );
});

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
