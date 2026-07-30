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
      // The local Worker is still starting.
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
  const markup = documentMarkup(html).replace(
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

test("Home stays within the v1.2 editorial and chapter contract", async () => {
  const html = await renderHtml("/");
  const markup = documentMarkup(html);
  const visible = defaultVisibleHomeText(html);
  const careerSection =
    markup.match(
      /<section\b[^>]*aria-labelledby="career-chapters-title"[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  const workLinks = [
    ...careerSection.matchAll(/<a\b[^>]*href="\/work\/([^"?#]+)"/gi),
  ].map((match) => match[1]);

  assert(
    wordCount(visible) <= 300,
    `Default Home contains ${wordCount(visible)} visible words; budget is 300`,
  );
  assert.equal((markup.match(/<details\b/g) ?? []).length, 5);
  assert.equal(workLinks.length, 12);
  assert.equal(new Set(workLinks).size, 12);
  assert.match(
    markup,
    /<details\b[^>]*data-selected="true"[^>]*open/i,
    "The newest visible chapter must be selected by default",
  );
  assert.equal(occurrences(visible, "Explore my work"), 1);
  assert.equal(occurrences(visible, "7K+"), 1);
  assert.equal(occurrences(visible, "Nearly 100K"), 1);
  assert.equal(occurrences(visible, "$2M+"), 1);
  assert.doesNotMatch(
    visible,
    /Teach\. Build\. Convene|representative work|public forms? archive/i,
  );
});

test("Work is one paginated two-dimensional canonical index", async () => {
  const html = await renderHtml("/work");
  const markup = documentMarkup(html);
  const workList =
    markup.match(/<ol\b[^>]*start="1"[^>]*>([\s\S]*?)<\/ol>/i)?.[1] ?? "";
  assert.equal((workList.match(/<li\b/g) ?? []).length, 24);
  assert.equal((markup.match(/<input\b[^>]*type="search"/gi) ?? []).length, 1);
  for (const name of ["topic", "year", "format", "organization", "role"]) {
    assert.match(markup, new RegExp(`<select\\b[^>]*name="${name}"`, "i"));
  }
  assert.doesNotMatch(markup, /\bMap\b|Visual archive|Browse all 186|<canvas\b/i);
  assert.doesNotMatch(markup, /name="practice"/i);
  assert.doesNotMatch(markup, /name="view"/i);
});

test("child-title search returns the parent and identifies the matching form", async () => {
  const child = publicBundle.items.find((item) => item.id === "item:fp-0145");
  assert(child);
  const entity = publicBundle.entities.find(
    (candidate) => candidate.id === child.canonicalEntityId,
  );
  assert(entity);
  const html = await renderHtml(
    `/work?q=${encodeURIComponent(child.displayTitle)}`,
  );
  assert.match(html, /Matched public form:/i);
  assert.match(html, new RegExp(child.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(`/work/${entity.slug}#${child.id}`));
});

test("child slugs search and redirect to the exact form anchor", async () => {
  const entityById = new Map(
    publicBundle.entities.map((entity) => [entity.id, entity]),
  );
  const child = publicBundle.items.find((item) => {
    const entity = entityById.get(item.canonicalEntityId);
    return (
      entity?.countability === "unique_work" &&
      entity.sourceBasis !== "supplemental" &&
      item.id !== entity.primaryItemId &&
      entity.slugAliases.includes(item.slug)
    );
  });
  assert(child, "Expected a legacy child slug shared with its entity aliases");
  const entity = entityById.get(child.canonicalEntityId);
  assert(entity);

  const searchHtml = await renderHtml(
    `/work?q=${encodeURIComponent(child.slug)}`,
  );
  assert.match(searchHtml, /Matched public form:/i);
  assert.match(searchHtml, new RegExp(`/work/${entity.slug}#${child.id}`));

  const response = await fetch(`${BASE_URL}/work/${child.slug}`, {
    redirect: "manual",
  });
  assert([307, 308].includes(response.status));
  const location = new URL(response.headers.get("location"), BASE_URL);
  assert.equal(location.pathname, `/work/${entity.slug}`);
  assert.equal(location.hash, `#${child.id}`);
});

test("single- and multi-form Work details avoid duplicate presentation", async () => {
  const indexed = publicBundle.entities.filter(
    (entity) =>
      entity.publicationState === "public" &&
      entity.countability === "unique_work" &&
      entity.sourceBasis !== "supplemental",
  );
  const single = indexed.find((entity) => entity.itemIds.length === 1);
  const multiple = indexed.find((entity) => entity.itemIds.length > 1);
  assert(single && multiple);

  const singleHtml = await renderHtml(`/work/${single.slug}`);
  const singleText = textFromMarkup(documentMarkup(singleHtml));
  assert.equal(
    occurrences(singleText, single.summary),
    1,
    "The single-form summary is repeated",
  );
  assert.doesNotMatch(singleHtml, /Appearances and artifacts/i);
  assert.match(singleHtml, /Open the |Historical source unavailable/i);

  const multiHtml = await renderHtml(`/work/${multiple.slug}`);
  const multiText = textFromMarkup(documentMarkup(multiHtml));
  assert.equal(
    occurrences(multiText, multiple.summary),
    1,
    "The multi-form summary is repeated",
  );
  assert.match(multiHtml, /Appearances and artifacts/i);
  for (const itemId of multiple.itemIds) {
    assert.match(
      multiHtml,
      new RegExp(`id="${itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
  }

  const duplicateTitleEntity = indexed.find((entity) => {
    const primary = publicBundle.items.find(
      (item) => item.id === entity.primaryItemId,
    );
    return (
      primary &&
      entity.itemIds.some((id) => {
        const item = publicBundle.items.find((candidate) => candidate.id === id);
        return (
          item &&
          item.id !== primary.id &&
          item.displayTitle === entity.displayTitle
        );
      })
    );
  });
  assert(duplicateTitleEntity);
  const duplicateTitleHtml = await renderHtml(
    `/work/${duplicateTitleEntity.slug}`,
  );
  assert.equal(
    occurrences(
      textFromMarkup(documentMarkup(duplicateTitleHtml)).toLocaleLowerCase(),
      "primary form",
    ),
    1,
    "Only the identity-selected primary item may be labeled primary",
  );
});

test("Work-detail outcomes are direct while wider measures remain contextual", async () => {
  const itemsById = new Map(publicBundle.items.map((item) => [item.id, item]));
  const entitiesById = new Map(
    publicBundle.entities.map((entity) => [entity.id, entity]),
  );

  for (const metric of publicBundle.metrics) {
    if (!metric.displaySurfaces?.includes("item_detail")) continue;
    const item = itemsById.get(metric.subjectId);
    const entity = entitiesById.get(metric.subjectId);
    if (!item && !entity) continue;
    const sampleEntity = entity ?? entitiesById.get(item.canonicalEntityId);
    if (
      !sampleEntity?.slug ||
      sampleEntity.countability !== "unique_work" ||
      !sampleEntity.itemIds.length
    ) {
      continue;
    }
    const html = await renderHtml(`/work/${sampleEntity.slug}`);
    const directText = textFromMarkup(
      sectionMarkupByLabel(html, "outcomes-title"),
    ).toLocaleLowerCase();
    const metricText = `${metric.displayValue} ${metric.label}`
      .toLocaleLowerCase();
    const approved =
      metric.subjectId === sampleEntity.id ||
      sampleEntity.itemIds.includes(metric.subjectId);
    assert.equal(
      directText.includes(metricText),
      Boolean(approved),
      `${metric.id} direct-outcome policy is incorrect`,
    );
  }

  for (const metric of publicBundle.metrics.filter(
    (candidate) => !candidate.displaySurfaces?.includes("item_detail"),
  )) {
    const contextEntity = entitiesById.get(metric.subjectId);
    const contextItem = contextEntity?.itemIds
      .map((id) => itemsById.get(id))
      .find(Boolean);
    const workEntity = contextItem
      ? entitiesById.get(contextItem.canonicalEntityId)
      : undefined;
    if (!workEntity?.slug || workEntity.countability !== "unique_work") continue;
    const html = await renderHtml(`/work/${workEntity.slug}`);
    const directText = textFromMarkup(
      sectionMarkupByLabel(html, "outcomes-title"),
    ).toLocaleLowerCase();
    assert(
      !directText.includes(
        `${metric.displayValue} ${metric.label}`.toLocaleLowerCase(),
      ),
      `${metric.id} leaked into a child Work as a direct outcome`,
    );
  }
});

test("Home owns the only Three.js consumer and keeps it deferred", async () => {
  const sourceEntries = await Promise.all(
    (await runtimeSourceFiles())
      .filter((file) => /\.(?:js|mjs|ts|tsx)$/i.test(file))
      .map(async (file) => ({ file, text: await readFile(file, "utf8") })),
  );
  const dynamicConsumers = sourceEntries.filter(({ text }) =>
    /\bimport\(\s*["']three["']\s*\)/.test(text),
  );
  assert.equal(dynamicConsumers.length, 1);
  assert.equal(
    path.relative(PROJECT_ROOT, dynamicConsumers[0].file),
    "components/CareerChapters.tsx",
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
  assert.equal(threeEntries.length, 1);
  assert.equal(threeEntries[0][1].isDynamicEntry, true);
  const homeHtml = await renderHtml("/");
  assert(!homeHtml.includes(threeEntries[0][1].file));
  const workHtml = await renderHtml("/work");
  assert(!workHtml.includes(threeEntries[0][1].file));
});

test("mobile, reduced-motion, Save-Data, and context loss are explicit no-Three paths", async () => {
  const source = await readFile(
    path.join(PROJECT_ROOT, "components/CareerChapters.tsx"),
    "utf8",
  );
  assert.match(source, /window\.innerWidth < 960/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /\.connection\?\.saveData/);
  assert.match(source, /webglcontextlost/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(source, /activeAnimation\?\.complete\(\)/);
  assert.match(source, /activeAnimation\?\.cancel\(\)/);
  assert.doesNotMatch(source, /requestAnimationFrame\(\s*(?:render|animate)\s*\)/);
});

test("Play remains consent-gated and has a complete no-JavaScript state", async () => {
  const html = await renderHtml("/play");
  const markup = documentMarkup(html);
  for (const provider of ["MyAnimeList", "Hardcover", "Steam", "Strava"]) {
    assert.match(markup, new RegExp(provider));
  }
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 4);
  const noScript = markup.match(/<noscript\b[\s\S]*?<\/noscript>/i)?.[0] ?? "";
  assert.equal((noScript.match(/<details\b/g) ?? []).length, 4);
  const rawNoScript =
    html.match(/<noscript\b[\s\S]*?<\/noscript>/i)?.[0] ?? "";
  assert.doesNotMatch(rawNoScript, /\.undefined\b/);
  const enhancedClass = rawNoScript.match(
    /<style>\.([^{}]+)\{display:none!important\}<\/style>/i,
  )?.[1];
  assert(enhancedClass, "The no-JavaScript state must hide enhanced controls");
  const escapedEnhancedClass = enhancedClass.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  assert.match(
    html,
    new RegExp(`class="[^"]*${escapedEnhancedClass}[^"]*"`),
    "The no-JavaScript selector must target the enhanced tab interface",
  );
  assert.doesNotMatch(markup, /<iframe\b|strava-embeds\.com/i);

  const source = await readFile(
    path.join(PROJECT_ROOT, "components/PersonalStreams.tsx"),
    "utf8",
  );
  assert.match(source, /active === "move" && !stravaEmbed/);
  assert.match(
    source,
    /if \(!embed\)\s*\{[\s\S]{0,300}?className=\{styles\.empty\}/,
    "An unpublished Strava stream must render the compact empty row",
  );
});

test("About has distinct biography and current-focus copy", async () => {
  const aboutText = textFromMarkup(
    documentMarkup(await renderHtml("/about")),
  );
  assert(
    !aboutText.includes(publicBundle.profile.summary),
    "About must not repeat the homepage thesis verbatim",
  );
  assert.match(aboutText, /Evaluation and agent-native product\./);
  assert.match(aboutText, /how should agents discover tools/i);
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
      file: "components/CareerChapters.module.css",
      selector: ".stage",
    },
  ]);
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
