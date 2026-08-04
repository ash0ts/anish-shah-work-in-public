import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
    throw new Error("Screenshot arguments must be --name value pairs.");
  }
  if (args.has(key)) throw new Error(`Duplicate argument: ${key}`);
  args.set(key, value);
}
function required(name) {
  const value = args.get(`--${name}`)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

const report = JSON.parse(await readFile(required("report"), "utf8"));
const origin = required("origin");
const outputDirectory = path.resolve(required("output"));
const resultPath = path.resolve(required("result"));
const accessClientId = process.env.ACCESS_CLIENT_ID?.trim();
const accessClientSecret = process.env.ACCESS_CLIENT_SECRET?.trim();
if (
  !/^https:\/\/pr-[1-9][0-9]{0,6}\.anish-shah-is\.online$/u.test(origin) ||
  !accessClientId ||
  accessClientId.length > 512 ||
  !accessClientSecret ||
  accessClientSecret.length > 2_048
) {
  throw new Error("Copy-preview screenshot configuration is invalid.");
}
if (
  report?.schemaVersion !== "1.0" ||
  !Array.isArray(report.affectedRoutes) ||
  report.affectedRoutes.length < 1
) {
  throw new Error("The trusted copy-preview report is invalid.");
}

const expanded = report.affectedRoutes.flatMap((route) =>
  route === "all-public-routes"
    ? [
        "/",
        "/work",
        "/play",
        "/play/watch",
        "/play/read",
        "/play/listen",
        "/play/collect",
        "/play/play",
        "/play/move",
        "/sources",
        "/privacy",
      ]
    : route === "/404"
      ? ["/copy-preview-not-found"]
      : [route],
);
if (report.affectedRoutes.includes("all-public-routes")) {
  const bundle = JSON.parse(
    await readFile("content/public/anish-content.public.v1.json", "utf8"),
  );
  const representativeGroups = bundle.workGroups
    .filter((group) => group.publicationState === "public")
    .sort(
      (left, right) =>
        right.title.length - left.title.length || left.slug.localeCompare(right.slug),
    )
    .slice(0, 2);
  expanded.push(...representativeGroups.map((group) => `/work/${group.slug}`));
}
const routes = [...new Set(expanded)]
  .filter((route) => /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/u.test(route))
  .sort();
if (routes.length < 1) throw new Error("No safe affected route was available.");

const viewports = [
  { name: "mobile-320", width: 320, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1_024 },
  { name: "desktop", width: 1440, height: 1_000 },
];
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
let captured = 0;
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
      extraHTTPHeaders: {
        "CF-Access-Client-Id": accessClientId,
        "CF-Access-Client-Secret": accessClientSecret,
      },
    });
    const page = await context.newPage();
    for (const route of routes) {
      const response = await page.goto(new URL(route, origin).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const expectedNotFound = route === "/copy-preview-not-found";
      if (
        !response ||
        (expectedNotFound ? response.status() !== 404 : response.status() !== 200)
      ) {
        throw new Error(`The synthetic preview did not render ${route}.`);
      }
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (overflow > 1) {
        throw new Error(`${route} overflows ${viewport.name} by ${overflow}px.`);
      }
      const filename = `${viewport.name}-${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}.png`;
      await page.screenshot({
        path: path.join(outputDirectory, filename),
        fullPage: true,
        animations: "disabled",
      });
      captured += 1;
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const total = routes.length * viewports.length;
await writeFile(
  resultPath,
  `${JSON.stringify({
    schemaVersion: "1.0",
    status: report.affectedRoutes.includes("all-public-routes")
      ? "passed; global copy sampled across every route family plus representative Work pages"
      : "passed; every affected route captured",
    coverage: report.affectedRoutes.includes("all-public-routes")
      ? "route-family-sample"
      : "complete",
    routes,
    captured,
    total,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(`Captured ${captured} synthetic copy-preview screenshots.`);
