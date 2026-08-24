import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import publicBundle from "../content/public/anish-content.public.v1.json" with {
  type: "json",
};

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
      "--var",
      "NODE_ENV:development",
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

after(async () => {
  if (server?.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
});

async function render(pathname = "/") {
  return fetch(`${BASE_URL}${pathname}`, {
    headers: { accept: "text/html" },
  });
}

async function renderWithoutFollowingRedirect(pathname) {
  return fetch(`${BASE_URL}${pathname}`, {
    headers: { accept: "text/html" },
    redirect: "manual",
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

function initiallyVisibleText(html) {
  const markup = documentMarkup(html).replace(
    /<details(?![^>]*\bopen\b)[^>]*>([\s\S]*?)<\/details>/gi,
    (_details, body) => body.match(/<summary\b[\s\S]*?<\/summary>/i)?.[0] ?? "",
  );
  return visibleText(markup);
}

test("homepage renders four topic rails and one qualified signal circuit", async () => {
  const html = await renderHtml("/");
  const markup = documentMarkup(html);
  const text = visibleText(html);

  assert.match(
    html,
    /<title>Applied AI systems that hold up after the demo — Anish Shah<\/title>/i,
  );
  assert.match(markup, />Anish</);
  assert.match(markup, />Shah</);
  assert.match(
    text,
    /I build the systems that make AI agents useful after the demo/i,
  );
  assert.match(text, /evaluation, observability, and tool interfaces/i);
  for (const line of [
    "Agent systems & open source",
    "Technical education",
    "Research, writing & implementations",
    "Talks, workshops & programs",
  ]) {
    assert.match(text, new RegExp(line.replaceAll("&", "&(?:amp;)?"), "i"));
  }
  assert.match(html, /See the work/i);
  assert.match(html, /Lines of work/i);
  assert.equal((markup.match(/data-work-line=/g) ?? []).length, 4);
  assert.equal(
    (markup.match(/<a\b[^>]*href="\/work\/[^"]+"/g) ?? []).length,
    0,
  );
  assert.equal(
    (markup.match(/<a\b[^>]*href="\/work\?bucket=[^"&]+#work-index"/g) ?? [])
      .length,
    4,
  );
  assert(
    (markup.match(
      /<a\b[^>]*href="\/work\?bucket=[^"]+(?:&amp;|&)topic=[^"]+#work-index"/g,
    ) ?? []).length <= 12,
  );
  for (const value of ["200K+", "7K+", "$4M+"]) {
    assert.match(
      text,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(text, /Three signals\. One method\./i);
  assert.match(
    text,
    /Independent measures; no shared scale\./i,
  );
  assert.match(text, /Method/i);
  assert.doesNotMatch(text, /What happened after the work shipped/i);
  assert.equal((markup.match(/data-impact-track=/g) ?? []).length, 3);
  assert.equal((markup.match(/data-signal-circuit/g) ?? []).length, 1);
  assert.equal(
    (markup.match(/<details\b[^>]*name="home-signal"/g) ?? []).length,
    3,
  );
  assert.match(text, /Direct project usage · not revenue/i);
  assert.match(text, /Enrollments · not unique learners/i);
  assert.match(text, /Supported pipeline · not revenue/i);
  assert.match(html, /Internal analytics/i);
  assert.match(html, /July 29 internal analytics checkpoint/i);
  assert.match(html, /Enrollments, not unique learners/i);
  assert.match(html, /not revenue, closed ARR, or personal attribution/i);
  for (const checkpoint of ["2026-07-29", "2026-07-30", "2025-10-01"]) {
    assert.match(html, new RegExp(`as of ${checkpoint}`, "i"));
  }
  assert.doesNotMatch(text, /Tool use followed the MCP server launch/i);
  assert.doesNotMatch(text, /Three AI courses turned working methods/i);
  assert.doesNotMatch(text, /Event programs supported downstream/i);
  assert.doesNotMatch(text, /More than two-thirds|About half/i);
  const main = markup.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? "";
  const mainWordCount =
    initiallyVisibleText(main).match(/[\p{L}\p{N}$+]+/gu)?.length ?? 0;
  assert(
    mainWordCount <= 140,
    `homepage main content exceeds 140 initially visible words (${mainWordCount})`,
  );
  assert.match(html, /property="og:image" content="[^"]*\/og\.jpg"/i);
  assert.match(html, /href="[^"]*\/favicon\.png"/i);
  for (const font of [
    "recursive-latin.woff2",
    "hanken-grotesk-latin.woff2",
    "ibm-plex-mono-medium-latin.woff2",
  ]) {
    assert.match(
      html,
      new RegExp(
        `<link[^>]+rel="preload"[^>]+href="[^"]*\\/fonts\\/${font.replace(".", "\\.")}"[^>]+as="font"[^>]+type="font\\/woff2"[^>]+crossorigin="anonymous"`,
        "i",
      ),
    );
  }
  assert.match(html, /href="#main"[^>]*>Skip to content/i);
  assert.doesNotMatch(markup, /<canvas\b/i);
});

test("all public routes expose useful server-rendered content", async () => {
  const routes = [
    {
      path: "/about",
      required: [
        /About · ML systems/i,
        /turn traces, evaluations, and tools into clearer next actions/i,
        /How the work developed/i,
        /2021–Now/i,
        /Weights &amp; Biases/i,
        /SAP &amp; Brilliant Hire by SAP/i,
        /Temple University/i,
        /Speaker profile/i,
        /Talks grounded in the systems I build/i,
        /Agent systems &amp; tool interfaces/i,
        /Evaluation &amp; observability/i,
        /Technical education &amp; workshops/i,
        /Copy speaker profile/i,
        /href="https:\/\/www\.linkedin\.com\/in\/anish-shah\/?"/i,
      ],
    },
    {
      path: "/work",
      required: [
        /Built, taught, tested\./i,
        /Choose a year and line\./i,
        /One project per record\. Talks, code, and recordings stay attached\./i,
        /Search the work/i,
        /name="bucket"/i,
        /name="topic"/i,
        /name="year"/i,
        /name="format"/i,
        /Agent systems &amp; open source/i,
        /Technical education/i,
        /Research, writing &amp; implementations/i,
        /Talks, workshops &amp; programs/i,
        /Browse all(?:\s|<!--.*?-->)+organizations/i,
        />Organizations</i,
        /href="\/work\?organization=google-cloud#work-index"/i,
      ],
    },
    {
      path: "/work/wandb-mcp-server",
      required: [/W&amp;B MCP Server/i, /Documented results/i, /Sources/i],
    },
    {
      path: "/play",
      required: [
        /The room behind the résumé\./i,
        /The objects tell the rest/i,
        />TV · Watch</i,
        />Bookshelf · Read</i,
        />Music player · Listen</i,
        />Record crate · Collect</i,
        />Computer · Games</i,
        />Treadmill · Move</i,
        /data-room-static-stage="true"/i,
        /aria-labelledby="room-directory-title"/i,
        /fetchpriority="high"/i,
        /my-room-2001-neutral-mobile\.[a-f0-9]{12}\.avif/i,
      ],
    },
    {
      path: "/sources",
      required: [
        /What the numbers mean/i,
        /id="public-footprint"/i,
        /id="internal-analytics"/i,
        /13(?:\s|<!--.*?-->)*claims, each with its limit/i,
        /Count each project once/i,
        /id="bibliography"/i,
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
    assert.match(html, /<main\b[^>]*\bid="main"[^>]*>/i);
  }
  const workHtml = await renderHtml("/work");
  assert.doesNotMatch(workHtml, /name="organization"/i);
  assert.doesNotMatch(workHtml, /name="role"/i);
  assert.doesNotMatch(
    visibleText(workHtml),
    /\b(?:I|me|my|mine|myself)\b/iu,
    "the default Work overview must remain artifact-first",
  );
  const workDescription = workHtml.match(
    /<meta\b(?=[^>]*\bname="description")(?=[^>]*\bcontent="([^"]*)")[^>]*>/i,
  )?.[1];
  assert(workDescription, "Work must expose a metadata description");
  assert.doesNotMatch(
    decodeHtml(workDescription),
    /\b(?:I|me|my|mine|myself)\b/iu,
    "Work metadata must remain artifact-first",
  );
});

test("About publishes a bounded career profile without resume-level private detail", async () => {
  const response = await fetch(`${BASE_URL}/about`, { redirect: "manual" });
  assert.equal(response.status, 200);
  const html = await response.text();
  const main = documentMarkup(html).match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? "";
  assert.equal((main.match(/<h1\b/gi) ?? []).length, 1);
  assert.match(main, /Contact on LinkedIn/i);
  assert.match(
    main,
    /Anish Shah builds agent systems, evaluation and observability workflows, and technical education at Weights &amp; Biases\./i,
  );
  assert.match(main, />https:\/\/www\.linkedin\.com\/in\/anish-shah<\/span>/i);
  assert.match(main, /<button\b[^>]*\bhidden(?:="")?[^>]*>\s*Copy speaker profile/i);
  assert.doesNotMatch(
    main,
    /mailto:|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{3}[-.)\s]+\d{3}[-.\s]+\d{4}\b|credential\s+id|certificate\s+id|street\s+address/i,
  );
});

test("Sources paginates the complete searchable bibliography 24 rows at a time", async () => {
  const compactHtml = await renderHtml("/sources");
  const compactMarkup = documentMarkup(compactHtml);
  const sourceText = visibleText(compactHtml);
  for (const value of [
    "184",
    "82",
    "198",
    "13",
    "Claims",
    "Method",
    "Sources",
  ]) {
    assert.match(sourceText, new RegExp(value.replace("+", "\\+"), "i"));
  }
  assert.doesNotMatch(sourceText, /184 footprint \+ 85 impact/i);
  assert.doesNotMatch(sourceText, /\b269\b/);
  assert.doesNotMatch(sourceText, /approved public claim/i);
  assert.match(sourceText, /Scope/i);
  assert.match(
    compactMarkup,
    /href="\/sources\?association=claim(?:&amp;|&)q=[^"]+#evidence:[^"]+"/i,
  );
  const compactIndex =
    compactMarkup.match(
      /<section\b[^>]*id="bibliography"[^>]*>[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  assert.equal(
    (compactIndex.match(/<li\b/g) ?? []).length,
    24,
    "the default bibliography should render its first 24 rows",
  );
  assert.match(compactIndex, /1—24 shown/i);
  assert.match(compactIndex, /Page 1 of 9/i);
  assert.match(
    compactIndex,
    /<form\b[^>]*action="\/sources#bibliography"[^>]*method="get"/i,
  );
  assert.match(compactIndex, /name="q"/i);
  assert.match(compactIndex, /name="kind"/i);
  assert.match(compactIndex, /name="association"/i);
  assert.equal(
    (compactIndex.match(/<li\b[^>]*id="evidence:[^"]+"/gi) ?? []).length,
    24,
    "each visible evidence row should expose a stable fragment target",
  );

  const secondHtml = await renderHtml("/sources?page=2");
  const secondIndex =
    documentMarkup(secondHtml).match(
      /<section\b[^>]*id="bibliography"[^>]*>[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  assert.equal((secondIndex.match(/<li\b/g) ?? []).length, 24);
  assert.match(secondIndex, /25—48 shown/i);
  assert.match(secondIndex, /Page 2 of 9/i);
  assert.doesNotMatch(secondIndex, /Browse all|Show the first/i);

  const searchHtml = await renderHtml("/sources?q=MCP");
  assert.match(searchHtml, /matching sources/i);
  assert.match(searchHtml, /MCP/i);

  const claimHtml = await renderHtml("/sources?association=claim");
  const claimIndex =
    documentMarkup(claimHtml).match(
      /<section\b[^>]*id="bibliography"[^>]*>[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  assert.match(claimIndex, /2 matching sources/i);
  assert.equal((claimIndex.match(/<li\b/g) ?? []).length, 2);
  assert.match(claimIndex, /value="claim" selected/i);

  const workHtml = await renderHtml("/sources?association=work");
  const workIndex =
    documentMarkup(workHtml).match(
      /<section\b[^>]*id="bibliography"[^>]*>[\s\S]*?<\/section>/i,
    )?.[0] ?? "";
  assert.match(
    workIndex,
    /href="\/sources\?association=work(?:&amp;|&)page=2#bibliography"/i,
    "association filtering should survive bibliography pagination",
  );
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

test("page-only Work URLs canonicalize to the calendar", async () => {
  const response = await renderWithoutFollowingRedirect("/work?page=2");
  assert.equal(response.status, 308);
  const location = new URL(response.headers.get("location"), BASE_URL);
  assert.equal(location.pathname, "/work");
  assert.equal(location.search, "");
});

test("legacy context routes land on a real nested anchor or a useful search", async () => {
  const related = await fetch(
    `${BASE_URL}/work/7-top-machine-learning-operations-startups-and-the-problem-they-solve`,
    { redirect: "manual" },
  );
  assert([307, 308].includes(related.status));
  const relatedLocation = new URL(related.headers.get("location"), BASE_URL);
  assert.equal(
    relatedLocation.pathname,
    "/work/orchestrating-reproducible-automl-experiments-using-pycaret-w-and-b-and-prefect",
  );
  assert.equal(relatedLocation.hash, "#item:fp-0100");
  const relatedHtml = await renderHtml(
    `${relatedLocation.pathname}${relatedLocation.hash}`,
  );
  assert.match(relatedHtml, /id="item:fp-0100"/i);
  assert.match(relatedHtml, /Related context/i);

  const unassociated = await fetch(
    `${BASE_URL}/work/fourthbrain-graduate-testimonial`,
    { redirect: "manual" },
  );
  assert([307, 308].includes(unassociated.status));
  const fallbackLocation = new URL(
    unassociated.headers.get("location"),
    BASE_URL,
  );
  assert.equal(fallbackLocation.pathname, "/work");
  assert.equal(
    fallbackLocation.searchParams.get("q"),
    "FourthBrain Graduate Testimonial",
  );
  assert.equal(fallbackLocation.hash, "#work-index");
});

test("the public shell has the exact compact navigation and footer contract", async () => {
  const html = documentMarkup(await renderHtml("/"));
  const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  const footer = html.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] ?? "";

  for (const label of ["About", "Work", "Play"]) {
    assert.match(header, new RegExp(`>${label}<`));
  }
  assert.match(header, /data-navigation-key="home"/i);
  assert.match(header, /aria-label="Anish Shah, home"/i);
  assert.match(header, /aria-current="page"/i);
  assert.match(header, /data-primary-navigation/i);
  assert.match(header, /data-primary-navigation-indicator/i);
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
  for (const pathname of ["/", "/work", "/play", "/sources", "/privacy"]) {
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
  const socialPreviewSize = (
    await stat(path.join(DIST_ROOT, "client/og.jpg"))
  ).size;
  assert(socialPreviewSize > 0);
  assert(
    socialPreviewSize < 200_000,
    `Social preview is ${socialPreviewSize} bytes; budget is 200 KB`,
  );
  assert((await stat(path.join(DIST_ROOT, "client/favicon.png"))).size > 0);
});

test("Home and Work omit 3D, canvas, and chart-library payloads", async () => {
  const workSource = await readFile(
    path.join(PROJECT_ROOT, "app/work/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(workSource, /three|canvas|VisualArchive/i);

  for (const pathname of ["/", "/work"]) {
    const html = await renderHtml(pathname);
    const markup = documentMarkup(html);
    assert.doesNotMatch(markup, /<canvas\b/i);
    const assets = [
      ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi),
    ].map((match) => match[1]);
    assert(assets.every((asset) => !/three/i.test(asset)));
    assert(
      assets.every((asset) => !/observablehq|WorkPlot|plot-/i.test(asset)),
      "Home and Work must not load a separate charting runtime",
    );
  }
});

test("robots and sitemap publish only public editorial surfaces", async () => {
  const [robots, sitemap] = await Promise.all([
    fetch(`${BASE_URL}/robots.txt`).then((response) => response.text()),
    fetch(`${BASE_URL}/sitemap.xml`).then((response) => response.text()),
  ]);
  assert.match(robots, /Disallow: \/studio/i);
  assert.match(robots, /Disallow: \/api\//i);
  assert.match(robots, /Sitemap: https:\/\/anish-shah-is\.online\/sitemap\.xml/i);
  assert.match(sitemap, /<loc>[^<]+\/work<\/loc>/i);
  assert.match(sitemap, /<loc>[^<]+\/work\/wandb-mcp-server<\/loc>/i);
  assert.match(sitemap, /<loc>[^<]+\/about<\/loc>/i);
  assert.doesNotMatch(sitemap, /\/studio|\/api\//i);
  assert.doesNotMatch(sitemap, /workers\.dev/i);
});

test("public pages expose canonical, social, and structured metadata", async () => {
  const routes = ["/", "/about", "/work", "/play", "/sources", "/privacy"];
  const socialTitles = new Set();
  for (const pathname of routes) {
    const html = await renderHtml(pathname);
    const canonical = html.match(
      /<link\b(?=[^>]*\brel="canonical")(?=[^>]*\bhref="([^"]+)")[^>]*>/i,
    )?.[1];
    assert(canonical, `${pathname} is missing its canonical link`);
    assert.equal(new URL(canonical).origin, "https://anish-shah-is.online");
    assert.equal(new URL(canonical).pathname, pathname);
    const socialTitle = html.match(
      /<meta\b(?=[^>]*\bproperty="og:title")(?=[^>]*\bcontent="([^"]+)")[^>]*>/i,
    )?.[1];
    assert(socialTitle, `${pathname} is missing an Open Graph title`);
    socialTitles.add(decodeHtml(socialTitle));
    const description = html.match(
      /<meta\b(?=[^>]*\bname="description")(?=[^>]*\bcontent="([^"]+)")[^>]*>/i,
    )?.[1];
    assert(description, `${pathname} is missing a description`);
    const descriptionLength = decodeHtml(description).length;
    assert(
      descriptionLength >= 80 && descriptionLength <= 160,
      `${pathname} description is ${descriptionLength} characters`,
    );
    assert.match(html, /name="twitter:card"[^>]*content="summary_large_image"/i);
  }
  assert.equal(socialTitles.size, routes.length);

  const [home, about, work] = await Promise.all([
    renderHtml("/"),
    renderHtml("/about"),
    renderHtml("/work/wandb-mcp-server"),
  ]);
  assert.match(home, /"@type":"ProfilePage"/);
  assert.match(home, /"@type":"Person"/);
  assert.match(home, /"@type":"WebSite"/);
  assert.match(about, /"@type":"ProfilePage"/);
  assert.match(about, /"@id":"https:\/\/anish-shah-is\.online\/#anish-shah"/);
  assert.doesNotMatch(about, /"@type":"Person"/);
  assert.match(work, /"@type":"CreativeWork"/);
  assert.match(work, /"@type":"BreadcrumbList"/);
  const conciseWorkSummary =
    "An MCP interface lets agents inspect W&amp;B experiments and traces. This page documents the role, public artifacts, and supporting sources.";
  const workDescription = work.match(
    /<meta\b(?=[^>]*\bname="description")(?=[^>]*\bcontent="([^"]+)")[^>]*>/i,
  )?.[1];
  assert.equal(workDescription, conciseWorkSummary);
  assert.match(
    work,
    /"description":"An MCP interface lets agents inspect W&B experiments and traces\. This page documents the role, public artifacts, and supporting sources\."/,
  );
});

test("every Work route keeps metadata and CreativeWork JSON-LD synchronized", { timeout: 120_000 }, async () => {
  const workGroups = publicBundle.workGroups.filter(
    (group) => group.publicationState === "public",
  );

  for (let index = 0; index < workGroups.length; index += 8) {
    const groupBatch = workGroups.slice(index, index + 8);
    const pages = await Promise.all(
      groupBatch.map(async (group) => ({
        group,
        html: await renderHtml(`/work/${encodeURIComponent(group.slug)}`),
      })),
    );

    for (const { group, html } of pages) {
      const encodedDescription = html.match(
        /<meta\b(?=[^>]*\bname="description")(?=[^>]*\bcontent="([^"]+)")[^>]*>/i,
      )?.[1];
      assert(encodedDescription, `${group.slug} is missing its description`);
      const description = decodeHtml(encodedDescription);
      assert(
        description.length >= 80 && description.length <= 160,
        `${group.slug} description is ${description.length} characters`,
      );

      const structuredDataSource = html.match(
        /<script\b(?=[^>]*\btype="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/i,
      )?.[1];
      assert(structuredDataSource, `${group.slug} is missing structured data`);
      const structuredData = JSON.parse(structuredDataSource);
      const creativeWork = structuredData["@graph"]?.find(
        (entry) => entry["@type"] === "CreativeWork",
      );
      assert(creativeWork, `${group.slug} is missing CreativeWork data`);
      assert.equal(
        creativeWork.description,
        description,
        `${group.slug} metadata and JSON-LD descriptions differ`,
      );
    }
  }
});

test("filtered variants are noindexed and the custom 404 is accessible", async () => {
  for (const pathname of ["/work?q=agents", "/sources?q=MCP"]) {
    const html = await renderHtml(pathname);
    assert.match(
      html,
      /<meta\b(?=[^>]*\bname="robots")(?=[^>]*\bcontent="[^"]*noindex[^"]*follow)[^>]*>/i,
    );
  }

  const response = await render("/this-page-does-not-exist");
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.match(html, /<main id="main"/i);
  assert.match(html, /That page isn’t here/i);
  assert.match(
    html,
    /<meta\b(?=[^>]*\bname="robots")(?=[^>]*\bcontent="[^"]*noindex)[^>]*>/i,
  );
});
