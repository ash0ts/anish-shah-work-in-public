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

  assert(
    wordCount(visible) <= 220,
    `Default Home contains ${wordCount(visible)} visible words; budget is 220`,
  );
  assert.equal(workLines.length, 4);
  assert.equal(workLinks.length, 4);
  assert.equal(new Set(workLinks).size, 4);
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
  assert.equal((calendarBody.match(/<tr\b/g) ?? []).length, 4);
  assert.equal((calendarBody.match(/<td\b/g) ?? []).length, 24);
  assert.match(
    calendar,
    /Projects by line and year, with exact project counts/i,
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
  assert.match(markup, />Line<|>Topic<|>Year<|>Medium</i);

  const pages = await Promise.all(
    [1, 2, 3, 4].map((page) =>
      page === 1 ? Promise.resolve(html) : renderHtml(`/work?page=${page}`),
    ),
  );
  const workIdsByPage = pages.map((pageHtml) => [
    ...documentMarkup(pageHtml).matchAll(
      /<li\b[^>]*data-work-id="([^"]+)"/gi,
    ),
  ].map((match) => match[1]));
  assert.deepEqual(workIdsByPage.map((ids) => ids.length), [24, 24, 24, 10]);
  assert.equal(new Set(workIdsByPage.flat()).size, 82);
  assert.deepEqual(
    new Set(workIdsByPage.flat()),
    new Set(publicBundle.workGroups.map((group) => group.id)),
  );
  assert.match(markup, /href="\/work\?page=2#work-index"/i);
  assert.doesNotMatch(
    markup,
    /\bMap\b|Visual archive|Complete grouped index|aria-pressed|<canvas\b|<svg\b/i,
  );
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
  assert.match(singleHtml, /Open the |Historical source unavailable/i);

  const multiHtml = await renderHtml(`/work/${multiple.slug}`);
  const multiText = textFromMarkup(documentMarkup(multiHtml));
  const multiSummary = copyDeck.workGroups[multiple.id].summary;
  assert.equal(
    occurrences(multiText, multiSummary),
    1,
    "The multi-form summary is repeated",
  );
  assert.match(multiHtml, /Talks, recordings, and code/i);
  for (const itemId of multiple.itemIds) {
    assert.match(
      multiHtml,
      new RegExp(`id="${itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
  }

  const primaryEntity = publicBundle.entities.find(
    (entity) => entity.id === multiple.primaryEntityId,
  );
  assert(primaryEntity);
  const duplicateTitleHtml = await renderHtml(`/work/${multiple.slug}`);
  assert.equal(
    occurrences(
      textFromMarkup(documentMarkup(duplicateTitleHtml)).toLocaleLowerCase(),
      "primary artifact",
    ),
    1,
    "Only the identity-selected item may be labeled the primary artifact",
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

test("Three.js stays inside the deferred Play room and out of archive navigation", async () => {
  const sourceEntries = await Promise.all(
    (await runtimeSourceFiles())
      .filter((file) => /\.(?:js|mjs|ts|tsx)$/i.test(file))
      .filter((file) => !file.includes("components/play/room-3d/"))
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
  for (const pathname of ["/", "/work"]) {
    assert.doesNotMatch(documentMarkup(await renderHtml(pathname)), /<canvas\b/i);
  }
});

test("Play remains consent-gated and has a complete no-JavaScript state", async () => {
  const html = await renderHtml("/play");
  const markup = documentMarkup(html);
  for (const provider of [
    "MyAnimeList",
    "Hardcover",
    "Spotify",
    "Discogs",
    "Steam",
    "Strava",
  ]) {
    assert.match(markup, new RegExp(provider));
  }
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 6);
  const noScript = markup.match(/<noscript\b[\s\S]*?<\/noscript>/i)?.[0] ?? "";
  assert.equal((noScript.match(/<details\b/g) ?? []).length, 6);
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
  assert.doesNotMatch(
    markup,
    /<iframe\b|open\.spotify\.com\/embed|strava-embeds\.com|www\.strava\.com\/athletes/i,
  );

  const [source, spotify, playPage] = await Promise.all([
    Promise.all(
      [
        "components/PersonalStreams.tsx",
        "components/play/MovementStream.tsx",
      ].map((file) => readFile(path.join(PROJECT_ROOT, file), "utf8")),
    ).then((files) => files.join("\n")),
    Promise.all(
      [
        "components/SpotifyStream.tsx",
        "components/spotify/SpotifyRankedGroove.tsx",
        "components/spotify/SpotifyTrackPresentation.tsx",
        "components/spotify/SpotifyFallback.tsx",
      ].map((file) => readFile(path.join(PROJECT_ROOT, file), "utf8")),
    ).then((files) => files.join("\n")),
    readFile(
      path.join(PROJECT_ROOT, "components/play/ClassicPlayExperience.tsx"),
      "utf8",
    ),
  ]);
  assert.match(
    source,
    /<SpotifyStream active=\{active === "listen"\} serverFallback=\{spotifyNoScript\}/,
  );
  assert.match(
    source,
    /active === "collect"[\s\S]*?<DiscogsStream/,
    "Discogs must mount only after Collect is selected",
  );
  assert.match(
    playPage,
    /spotifyNoScript=\{[\s\S]*?<ol>[\s\S]*?open\.spotify\.com\/track/,
    "The no-JavaScript Spotify state must receive a semantic ranked track list",
  );
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
    source,
    /active === "move"[\s\S]*?<MovementStream/,
  );
  assert.match(
    source,
    /function MovementStream[\s\S]*?if \(state\.status !== "ready"\)/,
    "An unpublished Strava stream must render the compact empty row",
  );
  assert.match(
    source,
    /function MovementStream[\s\S]*?show && state\.payload\.embed \? \([\s\S]*?<iframe/,
    "The Strava iframe must remain behind explicit visitor intent",
  );
});

test("Home absorbs the useful profile arc and About redirects permanently", async () => {
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
  assert.equal(response.status, 308);
  const location = new URL(response.headers.get("location"), BASE_URL);
  assert.equal(location.pathname, "/");
  assert.equal(location.hash, "#profile");
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
      file: "app/work/WorkTimeline.module.css",
      selector: ".frame caption",
    },
    {
      file: "components/PersonalStreams.module.css",
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
