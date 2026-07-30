import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const PORT = 41_000 + (process.pid % 8_000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let serverOutput = "";

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
      `.wrangler/rendered-test-${process.pid}`,
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: path.join(
          PROJECT_ROOT,
          `.wrangler/rendered-test-${process.pid}.log`,
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

async function render(pathname = "/") {
  return fetch(`${BASE_URL}${pathname}`, {
    headers: { accept: "text/html" },
  });
}

async function renderHtml(pathname) {
  const response = await render(pathname);
  assert.equal(response.status, 200, `${pathname} did not render`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
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

function visibleText(html) {
  return decodeHtml(documentMarkup(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

test("homepage renders the Career Chapters story and three qualified metrics", async () => {
  const html = await renderHtml("/");
  const markup = documentMarkup(html);

  assert.match(html, /<title>Applied AI, in public — Anish Shah<\/title>/i);
  assert.match(markup, />ANISH</);
  assert.match(markup, />SHAH</);
  assert.match(html, /applied AI builder, educator, and technical storyteller/i);
  assert.match(html, /Explore my work/i);
  assert.match(html, /Career Chapters/i);
  assert.equal((markup.match(/<details\b/g) ?? []).length, 5);
  assert.equal(
    (markup.match(/<a\b[^>]*href="\/work\/[^"]+"/g) ?? []).length,
    12,
  );
  for (const value of ["7K+", "Nearly 100K", "$2M+"]) {
    assert.match(visibleText(html), new RegExp(value.replace("$", "\\$")));
  }
  assert.equal(
    (markup.match(/<article\b/g) ?? []).length,
    3,
    "Home must expose exactly three metric articles",
  );
  assert.match(html, /Internal analytics/i);
  assert.match(html, /as of 2026/i);
  assert.match(html, /property="og:image" content="[^"]*\/og\.png"/i);
  assert.match(html, /href="[^"]*\/favicon\.png"/i);
  assert.match(html, /href="#main"[^>]*>Skip to content/i);
  assert.doesNotMatch(markup, /<canvas\b/i);
});

test("all public routes expose useful server-rendered content", async () => {
  const routes = [
    {
      path: "/work",
      required: [
        /Work, with its public forms attached\./i,
        /Search work and public forms/i,
        /name="topic"/i,
        /name="year"/i,
        /name="format"/i,
        /Chronological index/i,
      ],
    },
    {
      path: "/work/wandb-mcp-server",
      required: [/W&amp;B MCP Server/i, /Direct outcomes/i, /Public evidence/i],
    },
    {
      path: "/play",
      required: [
        /Outside the work\./i,
        /MyAnimeList/i,
        /Hardcover/i,
        /Steam/i,
        /Strava/i,
        /<noscript\b/i,
      ],
    },
    {
      path: "/about",
      required: [/About/i, /Applied AI/i, /Weights &amp; Biases/i, /2021—now/i],
    },
    {
      path: "/sources",
      required: [
        /Sources/i,
        /id="public-footprint"/i,
        /id="internal-analytics"/i,
        /13(?:\s|<!--.*?-->)*measures in four contexts/i,
        /public bibliography/i,
      ],
    },
    {
      path: "/privacy",
      required: [/Personal data stays deliberately small/i, /Storage and retention/i],
    },
  ];

  for (const route of routes) {
    const html = await renderHtml(route.path);
    for (const pattern of route.required) {
      assert.match(html, pattern, `${route.path} is missing ${pattern}`);
    }
    assert.match(html, /<main id="main"/i);
  }
});

test("Sources defaults to a compact server-searchable bibliography", async () => {
  const compactHtml = await renderHtml("/sources");
  const compactMarkup = documentMarkup(compactHtml);
  const compactIndex =
    compactMarkup.match(
      /<section\b[^>]*id="bibliography"[^>]*>[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  assert.equal(
    (compactIndex.match(/<li\b/g) ?? []).length,
    12,
    "the default bibliography should render only its first twelve rows",
  );
  assert.match(compactIndex, /Browse all 198 sources/i);
  assert.match(compactIndex, /<form\b[^>]*action="\/sources"[^>]*method="get"/i);
  assert.match(compactIndex, /name="q"/i);
  assert.match(compactIndex, /name="kind"/i);

  const completeHtml = await renderHtml("/sources?sources=all");
  const completeIndex =
    documentMarkup(completeHtml).match(
      /<section\b[^>]*id="bibliography"[^>]*>[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  assert.equal((completeIndex.match(/<li\b/g) ?? []).length, 198);
  assert.match(completeIndex, /Show the first 12/i);
  assert(
    compactHtml.length < completeHtml.length / 3,
    "the default Sources response should stay materially smaller than Browse all",
  );

  const searchHtml = await renderHtml("/sources?q=MCP");
  assert.match(searchHtml, /matching public sources/i);
  assert.match(searchHtml, /MCP/i);
});

test("legacy map URLs redirect to the two-dimensional Work index", async () => {
  const response = await fetch(
    `${BASE_URL}/work?view=map&q=agents&topic=agents&page=2`,
    { redirect: "manual" },
  );
  assert([307, 308].includes(response.status));
  const location = new URL(response.headers.get("location"), BASE_URL);
  assert.equal(location.pathname, "/work");
  assert.equal(location.searchParams.has("view"), false);
  assert.equal(location.searchParams.get("q"), "agents");
  assert.equal(location.searchParams.get("topic"), "agents");
  assert.equal(location.searchParams.get("page"), "2");
});

test("the public shell has the exact compact navigation and footer contract", async () => {
  const html = documentMarkup(await renderHtml("/"));
  const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  const footer = html.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] ?? "";

  for (const label of ["Work", "About", "Play"]) {
    assert.match(header, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(header, />Sources</);
  for (const label of ["LinkedIn", "GitHub", "W&amp;B", "Sources", "Privacy"]) {
    assert.equal(
      (footer.match(new RegExp(`>${label}<`, "g")) ?? []).length,
      1,
      `${label} must appear exactly once in the footer`,
    );
  }
  assert.match(footer, /© 2026 Anish Shah/);
  assert.doesNotMatch(
    footer,
    /Hugging Face|PyPI|DataTalksClub|Owner Studio|New York|proof travels/i,
  );
});

test("the public surface and build contain no removed experience or private provenance", async () => {
  const forbidden = [
    /field notes/i,
    /remotion/i,
    /motion[-_ ]?story/i,
    /react-loading-skeleton/i,
    /app\.notion\.com/i,
    /notion\.so/i,
    /app\.hex\.tech/i,
    /slack\.com\/archives/i,
    /documents\/new project/i,
    /\/users\/ashah/i,
  ];
  for (const pathname of ["/", "/work", "/play", "/about", "/sources", "/privacy"]) {
    const html = await renderHtml(pathname);
    for (const pattern of forbidden) {
      assert.doesNotMatch(html, pattern, `${pathname} contains ${pattern}`);
    }
  }

  const inspectable = (await walk(DIST_ROOT)).filter((file) =>
    /\.(?:css|html|js|json|map|mjs|sql|txt)$/i.test(file),
  );
  for (const file of inspectable) {
    const text = await readFile(file, "utf8");
    for (const pattern of [
      ...forbidden,
      /content\/private/i,
      /anish-content\.v1\.json/i,
    ]) {
      assert.doesNotMatch(
        text,
        pattern,
        `${path.relative(DIST_ROOT, file)} contains ${pattern}`,
      );
    }
  }
  assert.equal(existsSync(path.join(PROJECT_ROOT, "components/VisualArchive.tsx")), false);
  assert.equal(existsSync(path.join(PROJECT_ROOT, "components/LivingWorkIndex.tsx")), false);
  assert((await stat(path.join(DIST_ROOT, "client/og.png"))).size > 0);
  assert((await stat(path.join(DIST_ROOT, "client/favicon.png"))).size > 0);
});

test("Three.js is dynamic on Home and absent from the Work route", async () => {
  const careerSource = await readFile(
    path.join(PROJECT_ROOT, "components/CareerChapters.tsx"),
    "utf8",
  );
  const workSource = await readFile(
    path.join(PROJECT_ROOT, "app/work/page.tsx"),
    "utf8",
  );
  assert.match(careerSource, /import\("three"\)/);
  assert.doesNotMatch(careerSource, /^import .* from ["']three["'];?$/m);
  assert.doesNotMatch(workSource, /three|canvas|VisualArchive/i);

  const workHtml = await renderHtml("/work");
  assert.doesNotMatch(documentMarkup(workHtml), /<canvas\b/i);
  const workAssets = [
    ...workHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi),
  ].map((match) => match[1]);
  assert(workAssets.every((asset) => !/three/i.test(asset)));
});

test("robots and sitemap publish only public editorial surfaces", async () => {
  const [robots, sitemap] = await Promise.all([
    fetch(`${BASE_URL}/robots.txt`).then((response) => response.text()),
    fetch(`${BASE_URL}/sitemap.xml`).then((response) => response.text()),
  ]);
  assert.match(robots, /Disallow: \/studio/i);
  assert.match(robots, /Disallow: \/api\//i);
  assert.match(sitemap, /<loc>[^<]+\/work<\/loc>/i);
  assert.match(sitemap, /<loc>[^<]+\/work\/wandb-mcp-server<\/loc>/i);
  assert.doesNotMatch(sitemap, /\/studio|\/api\//i);
});
