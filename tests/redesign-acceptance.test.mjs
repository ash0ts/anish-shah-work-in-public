import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

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
      // The production worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Production server did not become ready.\n${serverOutput}`);
}, { timeout: 20_000 });

after(() => {
  if (server?.exitCode === null) server.kill("SIGTERM");
});

async function renderHtml(pathname) {
  if (!rendered.has(pathname)) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, `${pathname} did not render`);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
    );
    rendered.set(pathname, await response.text());
  }
  return rendered.get(pathname);
}

function documentMarkup(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
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

function visibleText(html) {
  return decodeHtml(
    documentMarkup(html)
      .replace(/<select\b[\s\S]*?<\/select>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value) {
  return value
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function anchorHrefs(html) {
  return [...documentMarkup(html).matchAll(
    /<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi,
  )].map((match) => decodeHtml(match[1]));
}

function representativeWorkSlugs(html) {
  return [...documentMarkup(html).matchAll(/<a\b[^>]*>/gi)].flatMap(
    ([tag]) => {
      if (!/\bclass="[^"]*\bv11-work-row\b[^"]*"/i.test(tag)) return [];
      const href = tag.match(
        /\bhref="\/work\/([^"?#]+)(?:[?#][^"]*)?"/i,
      );
      return href ? [href[1]] : [];
    },
  );
}

function sectionMarkupByClass(html, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return documentMarkup(html).match(
    new RegExp(
      `<section\\b(?=[^>]*\\bclass="[^"]*\\b${escaped}\\b[^"]*")[^>]*>[\\s\\S]*?<\\/section>`,
      "i",
    ),
  )?.[0] ?? "";
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

function topLevelSectionCount(html) {
  const stack = [];
  let count = 0;
  for (const [tag] of documentMarkup(html).matchAll(
    /<\/?(?:main|section)\b[^>]*>/gi,
  )) {
    const closing = /^<\//.test(tag);
    const name = tag.match(/^<\/?([a-z]+)/i)?.[1]?.toLocaleLowerCase();
    if (!name) continue;
    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    if (name === "section" && stack.at(-1) === "main") count += 1;
    stack.push(name);
  }
  return count;
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

test("homepage stays within the authored v1.1 content budget", async () => {
  const html = await renderHtml("/");
  const markup = documentMarkup(html);
  const text = visibleText(html);
  const workSlugs = representativeWorkSlugs(html);
  const uniqueWorkSlugs = new Set(workSlugs);

  assert.match(
    markup,
    /<a\b[^>]*href="\/work"[^>]*>[\s\S]{0,240}?Explore my work/i,
    "The primary Work CTA is missing",
  );
  assert(
    wordCount(text) <= 450,
    `Homepage contains ${wordCount(text)} visible words; budget is 450`,
  );
  assert(
    topLevelSectionCount(html) <= 4,
    "Homepage exceeds the hero plus three-module structural budget",
  );
  assert.equal(
    uniqueWorkSlugs.size,
    3,
    `Homepage contains ${uniqueWorkSlugs.size} editorial representatives; expected 3`,
  );
  assert.equal(
    workSlugs.length,
    uniqueWorkSlugs.size,
    "A selected work record is linked more than once on the homepage",
  );

  const itemsBySlug = new Map(
    [
      ...publicBundle.items,
      ...(publicBundle.entities ?? []),
    ].map((item) => [item.slug, item]),
  );
  const lowerText = text.toLocaleLowerCase();
  const repeatedTitles = [...uniqueWorkSlugs].flatMap((slug) => {
    const title = itemsBySlug.get(slug)?.title?.trim();
    if (!title || title.length < 8) return [];
    return occurrences(lowerText, title.toLocaleLowerCase()) > 1
      ? [title]
      : [];
  });
  assert.deepEqual(
    repeatedTitles,
    [],
    `Selected work titles are repeated in the hero and body: ${repeatedTitles.join(", ")}`,
  );

  const visibleMetrics = publicBundle.metrics.filter((metric) =>
    lowerText.includes(
      `${metric.displayValue} ${metric.label}`.toLocaleLowerCase(),
    ),
  );
  assert(
    visibleMetrics.length <= 3,
    `Homepage expands ${visibleMetrics.length} metrics; budget is 3`,
  );
});

test("work archive is complete without JavaScript and the visual view remains opt-in", async () => {
  const html = await renderHtml("/work");
  const markup = documentMarkup(html);
  const text = visibleText(html);
  const hrefs = anchorHrefs(html);
  const publicItems = publicBundle.items.filter(
    (item) => item.publicationState === "public",
  );
  const missing = publicItems
    .filter(
      (item) =>
        !hrefs.some(
          (href) =>
            href.split(/[?#]/, 1)[0] === `/work/${item.slug}` ||
            href.endsWith(`#${item.id}`),
        ),
    )
    .map((item) => item.id);

  assert.deepEqual(
    missing,
    [],
    `${missing.length} public records are absent from server-rendered HTML`,
  );
  assert.match(markup, /<input\b[^>]*type="search"/i);
  assert.doesNotMatch(markup, /<canvas\b/i);
  const controls = [
    ...markup.matchAll(/<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi),
  ]
    .map((match) => visibleText(match[1]));
  assert(
    controls.some((label) => /\b(?:map|visual archive|3d index)\b/i.test(label)),
    `No explicit Map/visual-archive activation control found: ${controls.join(", ")}`,
  );
  assert.match(
    text,
    new RegExp(`${publicItems.length} public (?:records|forms)`, "i"),
  );
});

test("work-detail outcomes are directly attributed, never inherited from a collection", async () => {
  const itemsById = new Map(
    publicBundle.items.map((item) => [item.id, item]),
  );
  const collectionsById = new Map(
    publicBundle.collections.map((collection) => [collection.id, collection]),
  );
  const entitiesById = new Map(
    (publicBundle.entities ?? []).map((entity) => [entity.id, entity]),
  );

  for (const metric of publicBundle.metrics) {
    const directItem = itemsById.get(metric.subjectId);
    const directEntity = entitiesById.get(metric.subjectId);
    const itemDetailApproved =
      metric.displaySurfaces?.includes("item_detail") ??
      Boolean(directItem);
    const expectedText = `${metric.displayValue} ${metric.label}`
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
    if (directItem) {
      const detailText = visibleText(sectionMarkupByClass(
        await renderHtml(`/work/${directItem.slug}`),
        "v11-case-outcomes",
      )).toLocaleLowerCase();
      assert.equal(
        detailText.includes(expectedText),
        itemDetailApproved,
        `${metric.id} item-detail display policy is not enforced`,
      );
      continue;
    }
    if (directEntity) {
      const sampleItem = directEntity.itemIds
        .map((id) => itemsById.get(id))
        .find(Boolean);
      if (!sampleItem) {
        assert.equal(
          itemDetailApproved,
          false,
          `${metric.id} is approved for item detail but has no public entity member`,
        );
        continue;
      }
      const detailText = visibleText(sectionMarkupByClass(
        await renderHtml(`/work/${sampleItem.slug}`),
        "v11-case-outcomes",
      )).toLocaleLowerCase();
      assert.equal(
        detailText.includes(expectedText),
        itemDetailApproved,
        `${metric.id} canonical-work display policy is not enforced`,
      );
      continue;
    }

    const collection = collectionsById.get(metric.subjectId);
    assert(collection, `${metric.id} has an unknown public subject`);
    const sampleItem = collection.itemIds
      .map((id) => itemsById.get(id))
      .find(Boolean);
    assert(sampleItem, `${metric.id} has no public collection sample`);
    const detailText = visibleText(sectionMarkupByClass(
      await renderHtml(`/work/${sampleItem.slug}`),
      "v11-case-outcomes",
    )).toLocaleLowerCase();
    assert(
      !detailText.includes(expectedText),
      `${sampleItem.id} inherited collection-wide outcome ${metric.id}`,
    );
  }
});

test("default Work keeps Three.js intent-loaded with a complete static fallback", async () => {
  const sourceFiles = (await runtimeSourceFiles()).filter((file) =>
    /\.(?:js|mjs|ts|tsx)$/i.test(file),
  );
  const sourceEntries = await Promise.all(
    sourceFiles.map(async (file) => ({
      file,
      text: await readFile(file, "utf8"),
    })),
  );
  const dynamicConsumers = sourceEntries.filter(({ text }) =>
    /\bimport\(\s*["']three["']\s*\)/.test(text),
  );

  assert(
    dynamicConsumers.length >= 1,
    "No intent-loaded Three.js consumer was found",
  );
  for (const { file, text } of sourceEntries) {
    assert.doesNotMatch(
      text,
      /^import(?:[\s\S]*?)from\s*["']three["'];?$/m,
      `${path.relative(PROJECT_ROOT, file)} statically imports Three.js`,
    );
  }
  const manifest = JSON.parse(await readFile(CLIENT_MANIFEST_PATH, "utf8"));
  const entries = Object.entries(manifest);
  const threeEntries = entries.filter(
    ([, entry]) => /node_modules\/three\//.test(entry.src ?? ""),
  );
  assert.equal(
    threeEntries.length,
    1,
    `Expected one browser Three.js chunk, found ${threeEntries.length}`,
  );
  const [threeKey, threeEntry] = threeEntries[0];
  assert.equal(threeEntry.isDynamicEntry, true);
  assert(
    entries.some(([, entry]) =>
      (entry.dynamicImports ?? []).includes(threeKey),
    ),
    "No client component dynamically imports the Three.js chunk",
  );
  for (const [key, entry] of entries) {
    if (key === threeKey) continue;
    assert(
      !(entry.imports ?? []).includes(threeKey),
      `${key} eagerly imports the Three.js implementation`,
    );
  }

  const homeHtml = await renderHtml("/");
  assert(
    !homeHtml.includes(threeEntry.file),
    `The homepage preloads ${threeEntry.file} before readable paint`,
  );
  assert.match(documentMarkup(homeHtml), /aria-label="Work by practice"/i);

  const workHtml = await renderHtml("/work");
  assert(
    !workHtml.includes(threeEntry.file),
    `The initial Work document preloads ${threeEntry.file}`,
  );
});

test("personal streams have a useful no-script state and never preload Strava", async () => {
  const html = await renderHtml("/play");
  const markup = documentMarkup(html);
  const text = visibleText(html);

  for (const label of ["MyAnimeList", "Hardcover", "Strava"]) {
    assert.match(text, new RegExp(label, "i"));
  }
  assert.match(markup, /<noscript\b/i);
  assert.match(text, /no connector request or third-party embed has been made/i);
  assert.doesNotMatch(markup, /<iframe\b/i);
  assert.doesNotMatch(markup, /strava-embeds\.com/i);
});

test("removed film runtimes and private provenance cannot re-enter public code or routes", async () => {
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
    `Remotion dependencies found: ${dependencyNames.join(", ")}`,
  );
  assert.equal(existsSync(path.join(PROJECT_ROOT, "motion")), false);

  const forbiddenRuntime = [
    /field notes/i,
    /@remotion\//i,
    /from\s+["']remotion["']/i,
    /motion[-_ ]story/i,
  ];
  for (const file of await runtimeSourceFiles()) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbiddenRuntime) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(PROJECT_ROOT, file)} contains ${pattern}`,
      );
    }
  }

  const routePaths = ["/", "/work", "/play", "/about", "/sources"];
  const forbiddenPublic = [
    /field notes/i,
    /remotion/i,
    /motion[-_ ]story/i,
    /app\.notion\.com/i,
    /notion\.so/i,
    /app\.hex\.tech/i,
    /slack\.com\/archives/i,
    /documents\/new project/i,
    /\/users\/ashah/i,
  ];
  for (const pathname of routePaths) {
    const html = await renderHtml(pathname);
    for (const pattern of forbiddenPublic) {
      assert.doesNotMatch(
        html,
        pattern,
        `${pathname} contains private or removed material matching ${pattern}`,
      );
    }
  }
});

test("public responsive contracts retain the audited viewport boundaries", async () => {
  const css = await readFile(path.join(PROJECT_ROOT, "app/globals.css"), "utf8");
  for (const width of [1050, 760, 390]) {
    assert.match(
      css,
      new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)`),
      `Missing the ${width}px public breakpoint`,
    );
  }
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
