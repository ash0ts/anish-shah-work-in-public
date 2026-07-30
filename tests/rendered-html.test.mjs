import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const PUBLIC_BUNDLE_PATH = path.join(
  PROJECT_ROOT,
  "content/public/anish-content.public.v1.json",
);
const publicBundle = JSON.parse(await readFile(PUBLIC_BUNDLE_PATH, "utf8"));
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
      ".wrangler/rendered-test",
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: path.join(
          PROJECT_ROOT,
          ".wrangler/rendered-test.log",
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

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      assert.fail(`Production server exited early.\n${serverOutput}`);
    }
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Production server did not become ready.\n${serverOutput}`);
}, { timeout: 15_000 });

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
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
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

test("homepage communicates identity, focus, evidence, and its primary action", async () => {
  const html = await renderHtml("/");

  assert.match(html, /<title>Applied AI, in public — Anish Shah<\/title>/i);
  assert.match(html, />ANISH</);
  assert.match(html, />SHAH</);
  assert.match(html, /applied AI builder, educator, and technical storyteller/i);
  assert.match(html, /Explore my work/i);
  assert.match(html, /Teach\. Build\. Convene\./i);
  assert.match(html, /Three bounded outcomes/i);
  assert.match(html, /property="og:image" content="\/og\.png"/i);
  assert.match(html, /href="\/favicon\.png"/i);
  assert.match(html, /href="#main"[^>]*>Skip to content/i);
});

test("all public editorial routes render useful server-side fallbacks", async () => {
  const sample = publicBundle.items.find(
    (item) => item.publicationState === "public",
  );
  assert(sample?.slug);

  const routes = [
    {
      path: "/work",
      required: [
        /One body of work\. Many public forms\./i,
        /Map[\s\S]{0,64}loads 3D/i,
        /Search work and public forms/i,
        /Browse all(?:\s|<!--.*?-->)*186(?:\s|<!--.*?-->)*public forms/i,
      ],
    },
    {
      path: `/work/${sample.slug}`,
      required: [
        new RegExp(sample.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        /Evidence/i,
      ],
    },
    {
      path: "/play",
      required: [
        /There is life/i,
        /outside the work\./i,
        /Personal snapshots are optional\./i,
        /MyAnimeList/i,
        /Hardcover/i,
        /Steam/i,
        /Strava/i,
      ],
    },
    {
      path: "/about",
      required: [/About/i, /Applied AI/i, /Weights &amp; Biases/i],
    },
    {
      path: "/sources",
      required: [
        /Sources/i,
        /Updated(?:\s|<!--.*?-->)*July 30, 2026/i,
        /id="public-footprint"/i,
        /id="internal-analytics"/i,
        /public bibliography/i,
      ],
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

test("the public surface contains no removed experience or private provenance", async () => {
  const paths = ["/", "/work", "/play", "/about", "/sources"];
  const forbidden = [
    /field notes/i,
    /remotion/i,
    /motion[-_ ]?story/i,
    /react-loading-skeleton/i,
    /your site is taking shape/i,
    /app\.notion\.com/i,
    /notion\.so/i,
    /app\.hex\.tech/i,
    /slack\.com\/archives/i,
    /documents\/new project/i,
    /\/users\/ashah/i,
  ];

  for (const pathname of paths) {
    const html = await renderHtml(pathname);
    for (const pattern of forbidden) {
      assert.doesNotMatch(html, pattern, `${pathname} contains ${pattern}`);
    }
  }
});

test("the production artifact excludes private content and removed runtimes", async () => {
  const files = await walk(DIST_ROOT);
  const inspectable = files.filter((file) =>
    /\.(?:css|html|js|json|map|mjs|sql|txt)$/i.test(file),
  );
  const forbidden = [
    /field notes/i,
    /remotion/i,
    /@remotion/i,
    /motion[-_ ]?story/i,
    /react-loading-skeleton/i,
    /app\.notion\.com/i,
    /notion\.so/i,
    /app\.hex\.tech/i,
    /slack\.com\/archives/i,
    /documents\/new project/i,
    /content\/private/i,
    /anish-content\.v1\.json/i,
  ];

  for (const file of inspectable) {
    const text = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        text,
        pattern,
        `${path.relative(DIST_ROOT, file)} contains ${pattern}`,
      );
    }
  }

  const og = await stat(path.join(DIST_ROOT, "client/og.png"));
  const favicon = await stat(path.join(DIST_ROOT, "client/favicon.png"));
  assert(og.size > 0);
  assert(favicon.size > 0);
});

test("Three.js remains a dynamically loaded archive dependency", async () => {
  const source = await readFile(
    path.join(PROJECT_ROOT, "components/VisualArchive.tsx"),
    "utf8",
  );
  assert.match(source, /await import\("three"\)/);
  assert.doesNotMatch(source, /^import .* from ["']three["'];?$/m);

  const html = await renderHtml("/work");
  const scripts = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  assert(
    scripts.every((src) => !/three/i.test(src)),
    `Three.js was preloaded by ${scripts.join(", ")}`,
  );
});
