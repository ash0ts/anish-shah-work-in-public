import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCopyDeck } from "../scripts/lib/copy-deck.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PUBLIC_BUNDLE_PATH = path.join(
  PROJECT_ROOT,
  "content/public/anish-content.public.v1.json",
);
const CLIENT_MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "dist/client/.vite/manifest.json",
);
const publicBundle = JSON.parse(await readFile(PUBLIC_BUNDLE_PATH, "utf8"));
const copyDeck = await buildCopyDeck(PROJECT_ROOT);
const PORT = 50_000 + (process.pid % 5_000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let serverOutput = "";
const rendered = new Map();

before(async () => {
  server = spawn(
    path.join(PROJECT_ROOT, "node_modules/.bin/wrangler"),
    [
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--local",
      "--var",
      "NODE_ENV:development",
      "--var",
      "TRAVEL_ATLAS_MODE:atlas-v1",
      "--log-level",
      "error",
      "--persist-to",
      `.wrangler/redesign-test-${process.pid}`,
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: path.join(
          PROJECT_ROOT,
          `.wrangler/redesign-test-${process.pid}.log`,
        ),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server.exitCode !== null) {
      assert.fail(`Production server exited early.\n${serverOutput}`);
    }
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The local Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Production server did not become ready.\n${serverOutput}`);
}, { timeout: 20_000 });

after(async () => {
  if (server?.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
});

async function renderHtml(pathname) {
  if (!rendered.has(pathname)) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, `${pathname} did not render`);
    rendered.set(pathname, await response.text());
  }
  return rendered.get(pathname);
}

function documentMarkup(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function decodeHtml(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["nbsp", " "],
    ["quot", "\""],
  ]);
  return value
    .replace(/&#x([a-f0-9]+);/gi, (_match, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&#(\d+);/g, (_match, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name) => named.get(name) ?? match);
}

function textFromMarkup(markup) {
  return decodeHtml(markup.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function defaultVisibleHomeText(html) {
  const document = documentMarkup(html);
  const main = document.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? "";
  const markup = main.replace(
    /<details(?![^>]*\bopen\b)[^>]*>([\s\S]*?)<\/details>/gi,
    (_details, body) => body.match(/<summary\b[\s\S]*?<\/summary>/i)?.[0] ?? "",
  );
  return textFromMarkup(markup);
}

function wordCount(value) {
  return value
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function occurrences(haystack, needle) {
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) >= 0) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function sectionMarkupByLabel(html, labelledBy) {
  const escaped = labelledBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return documentMarkup(html).match(
    new RegExp(
      `<section\\b(?=[^>]*\\baria-labelledby="${escaped}")[^>]*>[\\s\\S]*?<\\/section>`,
      "i",
    ),
  )?.[0] ?? "";
}

async function runtimeSourceFiles() {
  const roots = ["app", "components", "lib", "worker"];
  const files = [];
  const visit = async (root) => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && /\.(?:js|mjs|ts|tsx|json|css)$/i.test(entry.name)) {
        files.push(target);
      }
    }
  };
  for (const root of roots) await visit(path.join(PROJECT_ROOT, root));
  return files;
}

test("Home stays within the compressed Bodies of Work contract", async () => {
  const html = await renderHtml("/");
  const markup = documentMarkup(html);
  const visible = defaultVisibleHomeText(html);
  const bodiesSection =
    markup.match(
      /<section\b[^>]*aria-labelledby="lines-of-work-title"[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  const workLines = [
    ...bodiesSection.matchAll(/<li\b[^>]*data-work-line(?:="[^"]*")?[^>]*>/gi),
  ];
  const workLinks = [
    ...bodiesSection.matchAll(/<a\b[^>]*href="\/work\/([^"?#]+)"/gi),
  ].map((match) => match[1]);
  const bucketLinks = [
    ...bodiesSection.matchAll(
      /<a\b[^>]*href="\/work\?bucket=([^"&]+)#work-index"/gi,
    ),
  ];
  const topicLinks = [
    ...bodiesSection.matchAll(
      /<a\b[^>]*href="\/work\?bucket=[^"]+(?:&amp;|&)topic=[^"]+#work-index"/gi,
    ),
  ];

  assert(
    wordCount(visible) <= 140,
    `Default Home contains ${wordCount(visible)} visible words; budget is 140`,
  );
  assert.equal(workLines.length, 4);
  assert.equal(workLinks.length, 0);
  assert.equal(bucketLinks.length, 4);
  assert(topicLinks.length > 0 && topicLinks.length <= 12);
  assert.doesNotMatch(bodiesSection, /<details\b|<summary\b/i);
  assert.equal(occurrences(visible, "See the work"), 1);
  assert.equal(occurrences(visible, "7K+"), 1);
  assert.equal(occurrences(visible, "$4M+"), 1);
  assert.equal(occurrences(visible, "200K+"), 1);
  assert.equal(occurrences(visible, "More than two-thirds"), 0);
  assert.equal(occurrences(visible, "About half"), 0);
  assert.equal(
    (markup.match(/data-impact-track="(?:deployed|taught|programs)"/g) ?? [])
      .length,
    3,
  );
  assert.equal((markup.match(/data-signal-circuit/g) ?? []).length, 1);
  assert.equal(
    (markup.match(/<details\b[^>]*name="home-signal"/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(
    visible,
    /Teach\. Build\. Convene|representative work|Current focus|Operational ML|Generative systems|Evaluation & adoption|Agent-native product/i,
  );
});

test("Work keeps the four-line calendar primary and paginates canonical work", async () => {
  const html = await renderHtml("/work");
  const markup = documentMarkup(html);
  const calendar =
    markup.match(/<table\b[\s\S]*?<\/table>/i)?.[0] ?? "";
  const calendarBody =
    calendar.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const bodyDetails = [
    ...markup.matchAll(/<details\b[^>]*data-work-body="([^"]+)"/gi),
  ].map((match) => match[1]);
  const workIds = [
    ...markup.matchAll(/<li\b[^>]*data-work-id="([^"]+)"/gi),
  ].map((match) => match[1]);

  assert.deepEqual(bodyDetails, []);
  assert.deepEqual(workIds, []);
  assert.doesNotMatch(markup, /data-work-index-prompt|id="work-index"/i);
  assert.doesNotMatch(markup, /Showing 1—24|work-index-title/i);
  assert.match(markup, /id="work-calendar"/i);
  assert.match(
    markup,
    /<details\b(?=[^>]*id="work-organizations")(?![^>]*\bopen(?:=|\s|>))[^>]*>/i,
  );
  assert.match(markup, />Organizations<[\s\S]{0,160}>24</i);
  assert.doesNotMatch(
    markup,
    /id="work-context-organizations-title"|Organizations in this view/i,
  );
  assert.equal(
    (markup.match(/href="\/work\?organization=[^"]+#work-index"/gi) ?? [])
      .length,
    24,
  );
  assert.equal((calendarBody.match(/<tr\b/g) ?? []).length, 4);
  assert.equal((calendarBody.match(/<td\b/g) ?? []).length, 24);
  assert.match(
    calendar,
    /Projects by line and year/i,
  );
  assert.doesNotMatch(calendar, /public[- ]form|artifact count|formCount/i);
  assert.match(calendar, /data-density="[1-5]"/i);
  assert.match(
    calendar,
    /href="\/work\?bucket=products-open-source(?:&amp;|&)year=202[1-6]#work-index"/i,
  );
  assert.equal((markup.match(/<input\b[^>]*type="search"/gi) ?? []).length, 1);
  for (const name of ["bucket", "topic", "year", "format"]) {
    assert.match(markup, new RegExp(`<select\\b[^>]*name="${name}"`, "i"));
  }
  assert.doesNotMatch(markup, /<select\b[^>]*name="(?:organization|role)"/i);
  assert.match(
    markup,
    /<details\b[^>]*id="work-more-filters"[\s\S]*?<select\b[^>]*name="format"/i,
  );
  assert.match(markup, />Line of work<|>Topic<|>Year<|>Format</i);

  const selectedPages = await Promise.all([
    renderHtml("/work?year=2024"),
    renderHtml("/work?year=2024&page=2"),
  ]);
  const selectedMarkup = documentMarkup(selectedPages[0]);
  const workIdsByPage = selectedPages.map((pageHtml) => [
    ...documentMarkup(pageHtml).matchAll(
      /<li\b[^>]*data-work-id="([^"]+)"/gi,
    ),
  ].map((match) => match[1]));
  assert.equal(workIdsByPage[0].length, 24);
  assert(workIdsByPage[1].length > 0 && workIdsByPage[1].length <= 24);
  assert.equal(
    new Set(workIdsByPage.flat()).size,
    workIdsByPage.flat().length,
  );
  const canonicalWorkIds = new Set(
    publicBundle.workGroups.map((group) => group.id),
  );
  assert(workIdsByPage.flat().every((id) => canonicalWorkIds.has(id)));
  assert.match(selectedMarkup, /Showing 1—24 of \d+ projects/i);
  assert.match(
    selectedMarkup,
    /href="\/work\?year=2024(?:&amp;|&)page=2#work-index"/i,
  );
  assert.match(selectedMarkup, /id="work-index-title"/i);
  assert.match(
    selectedMarkup,
    /id="work-context-organizations-title"[^>]*>Organizations in this view</i,
  );
  assert.match(selectedMarkup, /aria-label="Active work scope"/i);
  assert.match(selectedMarkup, />Change filters</i);
  assert(
    (selectedMarkup.match(/data-variant="context"/gi) ?? []).length <= 6,
  );
  const contextualOrganizationHrefs = [
    ...selectedMarkup.matchAll(
      /<a\b(?=[^>]*data-variant="context")(?=[^>]*href="([^"]+)")[^>]*>/gi,
    ),
  ].map((match) => match[1].replaceAll("&amp;", "&"));
  assert(
    contextualOrganizationHrefs.every((href) =>
      new URL(href, "https://example.test").searchParams.has("year"),
    ),
  );
  assert.doesNotMatch(
    markup,
    /\bMap\b|Visual archive|Complete grouped index|<canvas\b|<svg\b/i,
  );
  assert.equal(
    (markup.match(/<button\b[^>]*aria-pressed="(?:true|false)"[^>]*data-work-year=/gi) ?? [])
      .length,
    6,
    "The six calendar-year controls should expose their selected state",
  );
  assert.doesNotMatch(markup, /name="practice"/i);
  assert.doesNotMatch(markup, /name="view"/i);

  const bucketMarkup = documentMarkup(
    await renderHtml("/work?bucket=products-open-source"),
  );
  assert.match(
    bucketMarkup,
    /id="work-index-title"[^>]*>Agent systems &amp; open source</i,
  );
  assert.doesNotMatch(bucketMarkup, /data-work-line=|data-work-body=/i);
  assert.match(
    bucketMarkup,
    /aria-label="Remove Agent systems &amp; open source bucket filter"/i,
  );

  const topicMarkup = documentMarkup(
    await renderHtml("/work?topic=agent-systems"),
  );
  assert.match(
    topicMarkup,
    /id="work-index-title"[^>]*>Agent systems projects</i,
  );
  assert.match(topicMarkup, /data-work-line=/i);

  const combinedMarkup = documentMarkup(
    await renderHtml(
      "/work?bucket=products-open-source&topic=agent-systems",
    ),
  );
  assert.match(
    combinedMarkup,
    /id="work-index-title"[^>]*>Agent systems · Agent systems &amp; open source</i,
  );
  assert.doesNotMatch(combinedMarkup, /data-work-line=|data-work-body=/i);

  const organizationHtml = await renderHtml(
    "/work?organization=google-cloud",
  );
  const organizationMarkup = documentMarkup(organizationHtml);
  assert.match(organizationMarkup, />Google Cloud projects</i);
  assert.equal(
    (organizationMarkup.match(/<li\b[^>]*data-work-id=/gi) ?? []).length,
    7,
  );
  assert.match(
    organizationMarkup,
    /href="\/work\?organization=google-cloud#work-index"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/work\?organization=google-cloud#work-index"/i,
  );
  assert.match(
    organizationMarkup,
    /aria-label="Remove Google Cloud organization filter"/i,
  );
  const organizationContextIds = [
    ...organizationMarkup.matchAll(
      /<a\b(?=[^>]*data-organization-id="([^"]+)")(?=[^>]*data-variant="context")[^>]*>/gi,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(organizationContextIds, [
    "google-cloud",
    "coreweave",
    "mlops-world",
    "odsc",
  ]);

  const fugueMarkup = documentMarkup(await renderHtml("/work?q=Fugue"));
  const fugueRow =
    fugueMarkup.match(
      /<li\b[^>]*data-work-id="group:standalone:wk-fp-0161"[^>]*>[\s\S]*?<\/li>/i,
    )?.[0] ?? "";
  assert.match(fugueRow, /<strong>Fugue<\/strong>/i);
  assert.doesNotMatch(
    fugueRow,
    /<strong>Fugue: governed experiments for AI agents<\/strong>/i,
  );

  const scopedOrganizationMarkup = documentMarkup(
    await renderHtml("/work?year=2024&organization=google-cloud"),
  );
  assert.match(
    scopedOrganizationMarkup,
    /aria-label="Remove Google Cloud organization filter"[^>]*href="\/work\?year=2024#work-index"|href="\/work\?year=2024#work-index"[^>]*aria-label="Remove Google Cloud organization filter"/i,
  );

  const emptyOrganizationMarkup = documentMarkup(
    await renderHtml("/work?q=no-such-project&organization=google-cloud"),
  );
  assert.match(
    emptyOrganizationMarkup,
    /id="work-context-organizations-title"[^>]*>Organizations in this view</i,
  );
  assert.match(
    emptyOrganizationMarkup,
    /aria-label="Remove Google Cloud organization filter"[^>]*href="\/work\?q=no-such-project#work-index"|href="\/work\?q=no-such-project#work-index"[^>]*aria-label="Remove Google Cloud organization filter"/i,
  );
  assert.match(emptyOrganizationMarkup, /No projects found/i);

  const legacyOrganizationMarkup = documentMarkup(
    await renderHtml("/work?organization=org%3Ajudgment-day-devpost"),
  );
  assert.match(legacyOrganizationMarkup, />Judgment Day \/ Devpost projects</i);
  assert.match(
    legacyOrganizationMarkup,
    /aria-label="Remove Judgment Day \/ Devpost organization filter"[^>]*href="\/work"|href="\/work"[^>]*aria-label="Remove Judgment Day \/ Devpost organization filter"/i,
  );
  assert.equal(
    (legacyOrganizationMarkup.match(/data-variant="context"/gi) ?? []).length,
    0,
  );
});

test("child-title search returns the parent and identifies the matching form", async () => {
  const child = publicBundle.items.find((item) => item.id === "item:fp-0145");
  assert(child);
  const entity = publicBundle.entities.find(
    (candidate) => candidate.id === child.canonicalEntityId,
  );
  assert(entity);
  const group = publicBundle.workGroups.find((candidate) =>
    candidate.itemIds.includes(child.id),
  );
  assert(group);
  const html = await renderHtml(
    `/work?q=${encodeURIComponent(child.displayTitle)}`,
  );
  assert.match(html, /Matched:/i);
  assert.doesNotMatch(html, /Matched public record:/i);
  assert.match(html, new RegExp(child.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(`/work/${group.slug}#${child.id}`));
});

test("child slugs search and redirect to the exact form anchor", async () => {
  const match = publicBundle.workGroups
    .flatMap((group) =>
      group.itemIds.map((itemId) => ({
        group,
        item: publicBundle.items.find((item) => item.id === itemId),
      })),
    )
    .find(({ group, item }) => item && item.slug !== group.slug);
  assert(match?.item, "Expected a nested public form with a legacy slug");
  const { group, item: child } = match;

  const searchHtml = await renderHtml(
    `/work?q=${encodeURIComponent(child.slug)}`,
  );
  assert.match(searchHtml, /Matched:/i);
  assert.doesNotMatch(searchHtml, /Matched public record:/i);
  assert.match(searchHtml, new RegExp(`/work/${group.slug}#${child.id}`));

  const response = await fetch(`${BASE_URL}/work/${child.slug}`, {
    redirect: "manual",
  });
  assert([307, 308].includes(response.status));
  const location = new URL(response.headers.get("location"), BASE_URL);
  assert.equal(location.pathname, `/work/${group.slug}`);
  assert.equal(location.hash, `#${child.id}`);

  const multiPrimary = publicBundle.workGroups
    .filter((candidate) => candidate.itemIds.length > 1)
    .map((candidate) => {
      const entity = publicBundle.entities.find(
        (entry) => entry.id === candidate.primaryEntityId,
      );
      const primaryItem = publicBundle.items.find(
        (entry) => entry.id === entity?.primaryItemId,
      );
      return { group: candidate, primaryItem };
    })
    .find(
      ({ group: candidate, primaryItem }) =>
        primaryItem && primaryItem.slug !== candidate.slug,
    );
  assert(multiPrimary?.primaryItem);
  const primaryResponse = await fetch(
    `${BASE_URL}/work/${multiPrimary.primaryItem.slug}`,
    { redirect: "manual" },
  );
  assert([307, 308].includes(primaryResponse.status));
  const primaryLocation = new URL(
    primaryResponse.headers.get("location"),
    BASE_URL,
  );
  assert.equal(primaryLocation.pathname, `/work/${multiPrimary.group.slug}`);
  assert.equal(primaryLocation.hash, `#${multiPrimary.primaryItem.id}`);
});

test("single- and multi-form WorkGroup details avoid duplicate presentation", async () => {
  const indexed = publicBundle.workGroups.filter(
    (group) => group.publicationState === "public",
  );
  const single = indexed.find((entity) => entity.itemIds.length === 1);
  const multiple = indexed.find((entity) => entity.itemIds.length > 1);
  assert(single && multiple);

  const singleHtml = await renderHtml(`/work/${single.slug}`);
  const singleText = textFromMarkup(documentMarkup(singleHtml));
  const singleSummary = copyDeck.workGroups[single.id].summary;
  assert.equal(
    occurrences(singleText, singleSummary),
    1,
    "The single-form summary is repeated",
  );
  assert.doesNotMatch(singleHtml, /Talks, recordings, and code/i);
  assert.match(
    singleHtml,
    /Read article|View event|Open course|Watch recording|Read report|Open reference|View credit|Read translation|Open mirror|View profile|View repository|View pull request|Historical source unavailable/i,
  );
  assert.match(
    singleHtml,
    new RegExp(
      `href="/work\\?bucket=${single.bucket}#work-index"`,
      "i",
    ),
  );
  const topicFilterLinks = [
    ...documentMarkup(singleHtml).matchAll(
      /<a\b[^>]*href="(\/work\?bucket=[^"#]+(?:&amp;|&)topic=[^"#]+#work-index)"[^>]*>/gi,
    ),
  ];
  assert(topicFilterLinks.length <= 3);

  const multiHtml = await renderHtml(`/work/${multiple.slug}`);
  const multiText = textFromMarkup(documentMarkup(multiHtml));
  const multiSummary = copyDeck.workGroups[multiple.id].summary;
  assert.equal(
    occurrences(multiText, multiSummary),
    1,
    "The multi-form summary is repeated",
  );
  assert.match(multiHtml, /Talks, recordings, and code/i);
  const multiPrimaryEntity = publicBundle.entities.find(
    (entity) => entity.id === multiple.primaryEntityId,
  );
  const multiPrimaryItemId = multiPrimaryEntity?.primaryItemId;
  assert(multiPrimaryItemId);
  assert.match(
    multiHtml,
    new RegExp(
      `<header[^>]*id="${multiPrimaryItemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
  for (const itemId of multiple.itemIds.filter(
    (itemId) => itemId !== multiPrimaryItemId,
  )) {
    assert.match(
      multiHtml,
      new RegExp(`id="${itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
  }

  const duplicateTitleHtml = await renderHtml(`/work/${multiple.slug}`);
  assert.doesNotMatch(
    textFromMarkup(documentMarkup(duplicateTitleHtml)),
    /primary artifact/i,
    "Work details should use the material's real type rather than content-model language",
  );
});

test("Work-detail outcomes are direct while wider measures remain contextual", async () => {
  for (const metric of publicBundle.metrics) {
    if (!metric.displaySurfaces?.includes("item_detail")) continue;
    const group = publicBundle.workGroups.find(
      (candidate) =>
        candidate.id === metric.subjectId ||
        candidate.memberEntityIds.includes(metric.subjectId) ||
        candidate.itemIds.includes(metric.subjectId),
    );
    if (!group) continue;
    const html = await renderHtml(`/work/${group.slug}`);
    const directText = textFromMarkup(
      sectionMarkupByLabel(html, "outcomes-title"),
    ).toLocaleLowerCase();
    const metricText = `${metric.displayValue} ${metric.label}`
      .toLocaleLowerCase();
    assert(
      directText.includes(metricText),
      `${metric.id} should be a direct outcome of ${group.id}`,
    );
  }

  for (const metric of publicBundle.metrics.filter(
    (candidate) => !candidate.displaySurfaces?.includes("item_detail"),
  )) {
    for (const group of publicBundle.workGroups.filter(
      (candidate) =>
        candidate.programEntityIds.includes(metric.subjectId) ||
        candidate.contextEntityIds.includes(metric.subjectId),
    )) {
      const html = await renderHtml(`/work/${group.slug}`);
      const directText = textFromMarkup(
        sectionMarkupByLabel(html, "outcomes-title"),
      ).toLocaleLowerCase();
      assert(
        !directText.includes(
          `${metric.displayValue} ${metric.label}`.toLocaleLowerCase(),
        ),
        `${metric.id} leaked into ${group.id} as a direct outcome`,
      );
    }
  }
});

test("Three.js stays inside deferred Play room and Travel boundaries", async () => {
  const sourceEntries = await Promise.all(
    (await runtimeSourceFiles())
      .filter((file) => /\.(?:js|mjs|ts|tsx)$/i.test(file))
      .filter((file) => !file.includes("components/play/room-3d/"))
      .filter((file) => !file.includes("components/play/travel/"))
      .map(async (file) => ({ file, text: await readFile(file, "utf8") })),
  );
  for (const { file, text } of sourceEntries) {
    assert.doesNotMatch(
      text,
      /(?:from\s*["']three["']|import\(\s*["']three["']\s*\)|WebGLRenderer|<canvas\b)/i,
      `${path.relative(PROJECT_ROOT, file)} contains out-of-scope 3D navigation`,
    );
  }

  const manifest = JSON.parse(await readFile(CLIENT_MANIFEST_PATH, "utf8"));
  const roomStage = manifest["components/play/room-3d/RoomStage.tsx"];
  assert.equal(
    roomStage?.isDynamicEntry,
    true,
    "the Three.js room must remain a dynamic entry",
  );
  assert.match(
    roomStage?.file ?? "",
    /^assets\/RoomStage-[\w-]+\.js$/,
    "the Three.js room must retain an independently cacheable chunk",
  );
  const travelStage = manifest["components/play/travel/TravelGlobeStage.tsx"];
  assert.equal(
    travelStage?.isDynamicEntry,
    true,
    "the Travel globe must remain a dynamic route-scoped entry",
  );
  assert.match(
    travelStage?.file ?? "",
    /^assets\/TravelGlobeStage-[\w-]+\.js$/,
    "the Travel globe must retain an independently cacheable chunk",
  );
  for (const pathname of ["/", "/work"]) {
    assert.doesNotMatch(documentMarkup(await renderHtml(pathname)), /<canvas\b/i);
  }
});

test("Play is a provider-free semantic room before an object route is opened", async () => {
  const html = await renderHtml("/play");
  const markup = documentMarkup(html);
  for (const object of [
    "watch",
    "read",
    "listen",
    "collect",
    "play",
    "move",
    "travel",
  ]) {
    assert.match(markup, new RegExp(`data-room-object-link="${object}"`));
  }
  assert.doesNotMatch(
    markup,
    /<iframe\b|api\/connectors|open\.spotify\.com\/embed|strava-embeds\.com/i,
  );

  const [overview, screens, spotify, movement] = await Promise.all([
    readFile(
      path.join(PROJECT_ROOT, "components/play/room-platform/RoomOverview.tsx"),
      "utf8",
    ),
    readFile(
      path.join(PROJECT_ROOT, "components/play/room-platform/room-screen-registry.ts"),
      "utf8",
    ),
    Promise.all(
      [
        "components/SpotifyStream.tsx",
        "components/spotify/SpotifyRankedGroove.tsx",
        "components/spotify/SpotifyTrackPresentation.tsx",
        "components/spotify/SpotifyFallback.tsx",
      ].map((file) => readFile(path.join(PROJECT_ROOT, file), "utf8")),
    ).then((files) => files.join("\n")),
    readFile(
      path.join(PROJECT_ROOT, "components/play/MovementStream.tsx"),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(overview, /getPublicConnector|fetch\(/);
  assert.match(screens, /listen: \(\) => import\("\.\.\/room-screens\/ListenRoomScreen"\)/);
  assert.match(screens, /collect: \(\) => import\("\.\.\/room-screens\/CollectRoomScreen"\)/);
  assert.match(spotify, /<svg[\s\S]*?className=\{styles\.groove\}/);
  assert.match(
    spotify,
    /<ol className=\{styles\.rankRail\}[\s\S]*?aria-label="Spotify Top Tracks in returned order"/,
  );
  assert.match(
    spotify,
    /onKeyDown=\{\(event\) => onRankKeyDown\(event, index, "groove"\)\}/,
  );
  assert.match(
    spotify,
    /showEmbed \? \([\s\S]*?<iframe|playerTrack \? \([\s\S]*?<SpotifyPlayer/,
    "Every Spotify iframe must remain behind explicit visitor intent",
  );
  assert.doesNotMatch(
    spotify,
    /<audio\b|AudioContext|webkitAudioContext|from\s+["']three["']|WebGL|autoplay;/i,
  );
  assert.match(
    movement,
    /function MovementStream[\s\S]*?if \(state\.status !== "ready"\)/,
    "An unpublished Strava stream must render the compact empty row",
  );
  assert.match(
    movement,
    /function MovementStream[\s\S]*?show && state\.payload\.embed \? \([\s\S]*?<iframe/,
    "The Strava iframe must remain behind explicit visitor intent",
  );
});

test("Home stays concise while About owns the bounded career chronology", async () => {
  const homeText = textFromMarkup(documentMarkup(await renderHtml("/")));
  assert.match(
    homeText,
    /I build the systems that make AI agents useful after the demo/i,
  );
  assert.doesNotMatch(
    homeText,
    /Current focus|Operational ML|Generative systems|Evaluation & adoption|Agent-native product/i,
  );

  const response = await fetch(`${BASE_URL}/about`, { redirect: "manual" });
  assert.equal(response.status, 200);
  const about = textFromMarkup(documentMarkup(await response.text()));
  assert.match(about, /How the practice developed/i);
  assert.match(about, /2021–Now/i);
  assert.match(about, /2017–2021/i);
  assert.match(about, /2016–2019/i);
});

test("the CSS architecture is scoped and has no page-level overflow masking", async () => {
  const globalCss = await readFile(
    path.join(PROJECT_ROOT, "app/globals.css"),
    "utf8",
  );
  assert(globalCss.split("\n").length < 400);
  assert.doesNotMatch(globalCss, /overflow(?:-x)?:\s*(?:hidden|clip)/i);

  const cssFiles = (await runtimeSourceFiles()).filter((file) =>
    file.endsWith(".css"),
  );
  const overflowMasking = [];
  for (const file of cssFiles) {
    const css = await readFile(file, "utf8");
    for (const match of css.matchAll(/([^{}]+)\{[^{}]*overflow:\s*(hidden|clip)/gi)) {
      overflowMasking.push({
        file: path.relative(PROJECT_ROOT, file),
        selector: match[1].trim(),
      });
    }
  }
  assert.deepEqual(overflowMasking, [
    {
      file: "app/studio/travel/travel.module.css",
      selector: ".mapTable",
    },
    {
      file: "app/studio/travel/travel.module.css",
      selector: ".visuallyHidden",
    },
    {
      file: "app/work/WorkTimeline.module.css",
      selector: ".frame caption",
    },
    {
      file: "components/play/StreamPresentation.module.css",
      selector: ".visuallyHidden",
    },
    {
      file: "components/play/room-3d/RoomStage.module.css",
      selector: ".stage",
    },
    {
      file: "components/play/room-platform/RoomExperienceProvider.module.css",
      selector: ".announcer",
    },
    {
      file: "components/play/room-platform/RoomExperienceProvider.module.css",
      selector: ".runtimeLoading picture",
    },
    {
      file: "components/play/room-platform/RoomOverview.module.css",
      selector: ".posterField",
    },
    {
      file: "components/play/room-platform/RoomRuntime.module.css",
      selector: ".announcer",
    },
    {
      file: "components/play/room-platform/RoomRuntime.module.css",
      selector: ".posterFallback",
    },
    {
      file: "components/play/room-screens/RoomScreens.module.css",
      selector: ".televisionGlass",
    },
    {
      file: "components/play/room-screens/RoomScreens.module.css",
      selector: ".playerDisplay",
    },
    {
      file: "components/play/room-screens/RoomScreens.module.css",
      selector: ".computerDisplay",
    },
    {
      file: "components/play/room-screens/RoomScreens.module.css",
      selector: ".cardioDisplay",
    },
    {
      file: "components/play/travel/PostcardPlanet.module.css",
      selector: ".srOnly",
    },
    {
      file: "components/play/travel/PostcardPlanet.module.css",
      selector: ".globeFrame",
    },
    {
      file: "components/play/travel/PostcardPlanet.module.css",
      selector: ".tripCard picture,\n.tripFallback",
    },
    {
      file: "components/play/travel/TravelGlobe.module.css",
      selector: ".canvas",
    },
  ]);
  const timelineCss = await readFile(
    path.join(PROJECT_ROOT, "app/work/WorkTimeline.module.css"),
    "utf8",
  );
  assert.match(
    timelineCss,
    /\.frame\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?overflow-x:\s*auto/,
    "Only the bounded calendar frame may scroll horizontally",
  );
  for (const width of [1050, 760, 390]) {
    assert.match(
      globalCss,
      new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)`),
    );
  }
  assert.match(globalCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("removed visual-map and film runtimes cannot return", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"),
  );
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  });
  assert(
    dependencyNames.every(
      (name) => !/(?:^|\/)remotion$|^@remotion\//i.test(name),
    ),
  );
  assert.equal(existsSync(path.join(PROJECT_ROOT, "motion")), false);
  assert.equal(existsSync(path.join(PROJECT_ROOT, "components/VisualArchive.tsx")), false);
  assert.equal(existsSync(path.join(PROJECT_ROOT, "components/LivingWorkIndex.tsx")), false);

  for (const file of await runtimeSourceFiles()) {
    const source = await readFile(file, "utf8");
    for (const pattern of [
      /field notes/i,
      /@remotion\//i,
      /from\s+["']remotion["']/i,
      /motion[-_ ]story/i,
    ]) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(PROJECT_ROOT, file)} contains ${pattern}`,
      );
    }
  }
});
