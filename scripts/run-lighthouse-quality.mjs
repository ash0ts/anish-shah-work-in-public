import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "http://127.0.0.1:4174";
const reportDirectory = path.join(root, ".lighthouse");
const routes = ["/", "/work", "/play", "/sources", "/privacy"];
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

function reportName(route) {
  return route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
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

await mkdir(reportDirectory, { recursive: true });

const server = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--port",
    "4174",
    "--ip",
    "127.0.0.1",
    "--local",
    "--var",
    "NODE_ENV:development",
    "--log-level",
    "error",
    "--persist-to",
    ".wrangler/lighthouse-quality",
  ],
  {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput = boundedOutput(serverOutput, chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput = boundedOutput(serverOutput, chunk);
});

const failures = [];

try {
  await waitForServer(server);

  for (const route of routes) {
    const url = new URL(route, baseUrl).href;
    let result;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await assertRouteAvailable(route, server, () => serverOutput);
      const chrome = await launchChrome();
      try {
        result = await lighthouse(url, {
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
      } finally {
        await chrome.kill();
      }

      if (!result?.lhr.runtimeError) break;
      if (attempt === 1) {
        console.warn(
          `${route} Lighthouse navigation failed once (${result.lhr.runtimeError.code}); retrying with a fresh browser.`,
        );
      }
    }

    if (!result) throw new Error(`Lighthouse returned no result for ${route}.`);
    if (result.lhr.runtimeError) {
      throw new Error(
        `Lighthouse could not audit ${route}: ${result.lhr.runtimeError.code} — ${result.lhr.runtimeError.message}`,
      );
    }
    const reportPath = path.join(reportDirectory, `${reportName(route)}.report.json`);
    await writeFile(reportPath, result.report, "utf8");

    const summary = {};
    for (const category of categories) {
      const score = result.lhr.categories[category]?.score;
      summary[category] = score;
      if (typeof score !== "number" || score < minimumScore) {
        failures.push(`${route} ${category}: ${score ?? "missing"} < ${minimumScore}`);
      }
    }

    const cls = result.lhr.audits["cumulative-layout-shift"]?.numericValue;
    summary.cls = cls;
    if (typeof cls !== "number" || cls > maximumCls) {
      failures.push(`${route} CLS: ${cls ?? "missing"} > ${maximumCls}`);
    }

    console.log(`${route} ${JSON.stringify(summary)}`);
  }
} catch (error) {
  if (serverOutput) console.error(serverOutput);
  throw error;
} finally {
  await stopProcess(server);
}

if (failures.length > 0) {
  throw new Error(`Lighthouse quality budgets failed:\n${failures.join("\n")}`);
}
