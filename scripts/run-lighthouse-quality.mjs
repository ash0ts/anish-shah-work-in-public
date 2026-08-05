import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
// Keep this in lockstep with Playwright. This is a test-process override for
// Wrangler 4.113's bundled workerd, not a production configuration value.
const e2eCompatibilityDate = "2026-07-28";
const lighthousePort = 4174;
const baseUrl = `http://127.0.0.1:${lighthousePort}`;
const reportDirectory = path.join(root, ".lighthouse");
const wranglerDirectory = path.join(root, ".wrangler");
const wranglerLogPath = path.join(wranglerDirectory, "lighthouse-quality.log");
const audits = [
  { mode: "room", routes: ["/", "/work", "/play", "/sources", "/privacy"] },
];
const categories = ["performance", "accessibility", "best-practices", "seo"];
const minimumScore = 0.9;
const maximumCls = 0.1;

function boundedOutput(current, chunk) {
  return `${current}${chunk}`.slice(-16_000);
}

async function waitForServer(server) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Wrangler exited before Lighthouse started (${server.exitCode}).`);
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      await response.body?.cancel();
      if (response.status > 0) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the Lighthouse Worker preview.");
}

async function assertRouteAvailable(route, server, serverOutput) {
  if (server.exitCode !== null) {
    throw new Error(
      `Wrangler exited before auditing ${route} (${server.exitCode}).\n${serverOutput()}`,
    );
  }
  const response = await fetch(new URL(route, baseUrl), { redirect: "manual" });
  await response.body?.cancel();
  if (response.status >= 500) {
    throw new Error(
      `Worker preview returned ${response.status} for ${route}.\n${serverOutput()}`,
    );
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function reportName(route, mode) {
  const routeName = route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
  return `${mode}-${routeName}`;
}

async function launchChrome() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await chromeLauncher.launch({
        chromePath: chromium.executablePath(),
        chromeFlags: [
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`Chrome launch attempt ${attempt} failed; retrying.`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError;
}

await Promise.all([
  mkdir(reportDirectory, { recursive: true }),
  mkdir(wranglerDirectory, { recursive: true }),
]);

function launchWorker() {
  // Run on loopback without a hosted deployment tier. Preview and staging are
  // intentionally noindexed, so auditing either tier would measure that
  // security boundary instead of the production SEO contract.
  const server = spawn(
    process.execPath,
    [
      "node_modules/wrangler-e2e/bin/wrangler.js",
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--compatibility-date",
      e2eCompatibilityDate,
      "--port",
      String(lighthousePort),
      "--ip",
      "127.0.0.1",
      "--local",
      "--var",
      "NODE_ENV:development",
      "--var",
      `RELEASE_VERSION:${releaseVersion}`,
      "--log-level",
      "error",
      "--persist-to",
      ".wrangler/lighthouse-quality",
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_LOG_PATH: wranglerLogPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  server.stdout.on("data", (chunk) => {
    output = boundedOutput(output, chunk);
  });
  server.stderr.on("data", (chunk) => {
    output = boundedOutput(output, chunk);
  });
  return { server, output: () => output };
}

async function runRouteAudit(route, server, serverOutput, chrome) {
  await assertRouteAvailable(route, server, serverOutput);
  return lighthouse(new URL(route, baseUrl).href, {
    port: chrome.port,
    output: "json",
    logLevel: "error",
    onlyCategories: categories,
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      disabled: false,
    },
  });
}

const failures = [];

const { server, output } = launchWorker();
let chrome;
try {
  await waitForServer(server);
  chrome = await launchChrome();
  for (const { mode, routes } of audits) {
    for (const route of routes) {
      const result = await runRouteAudit(route, server, output, chrome);
      if (!result?.lhr || result.lhr.runtimeError) {
        const runtime = result?.lhr?.runtimeError;
        throw new Error(
          runtime
            ? `${mode} ${route}: ${runtime.code} — ${runtime.message}`
            : `Lighthouse returned no result for ${mode} ${route}.`,
        );
      }
      const reportPath = path.join(
        reportDirectory,
        `${reportName(route, mode)}.report.json`,
      );
      await writeFile(reportPath, result.report, "utf8");

      const summary = {};
      for (const category of categories) {
        const score = result.lhr.categories[category]?.score;
        summary[category] = score;
        if (typeof score !== "number" || score < minimumScore) {
          failures.push(
            `${mode} ${route} ${category}: ${score ?? "missing"} < ${minimumScore}`,
          );
        }
      }

      const cls = result.lhr.audits["cumulative-layout-shift"]?.numericValue;
      summary.cls = cls;
      if (typeof cls !== "number" || cls > maximumCls) {
        failures.push(`${mode} ${route} CLS: ${cls ?? "missing"} > ${maximumCls}`);
      }

      console.log(`${mode} ${route} ${JSON.stringify(summary)}`);
    }
  }
} catch (error) {
  const detail = output();
  if (detail && error instanceof Error) error.message = `${error.message}\n${detail}`;
  throw error;
} finally {
  if (chrome) await chrome.kill();
  await stopProcess(server);
}

if (failures.length > 0) {
  throw new Error(`Lighthouse quality budgets failed:\n${failures.join("\n")}`);
}
