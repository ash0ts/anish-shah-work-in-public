import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCoverage, changesBetween } from "./lib/release-coverage.mjs";
import { validationIdentity } from "./lib/validation-receipt.mjs";

const phaseResults = [];
let browserIdentity = null;
let browserCoverage = null;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const declared = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
const required = [
  "@playwright/test",
  "@axe-core/playwright",
  "chrome-launcher",
  "lighthouse",
  "wrangler-e2e",
];
const missing = required.filter((dependency) => !declared[dependency]);
if (missing.length > 0) {
  throw new Error(
    `Browser-quality validation requires pinned direct dependencies: ${missing.join(", ")}.`,
  );
}

function run(binary, arguments_, environment = {}, { continueOnFailure = false } = {}) {
  const result = spawnSync(binary, arguments_, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status !== 0 && !continueOnFailure) process.exit(status);
  return status;
}

function runPlaywright({
  port,
  segment = "",
  arguments_ = [],
  simulationExperienceMode = "disabled",
}) {
  const suffix = segment ? `-${segment}` : "";
  const relativeStateDirectory = `.wrangler/browser-quality-room${suffix}`;
  const stateDirectory = path.join(root, relativeStateDirectory);
  rmSync(stateDirectory, { force: true, recursive: true });
  return run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...arguments_],
    {
      BROWSER_QUALITY_PORT: String(port),
      BROWSER_QUALITY_SEGMENT: segment,
      BROWSER_QUALITY_STATE_DIR: relativeStateDirectory,
      BROWSER_SIMULATION_EXPERIENCE_MODE: simulationExperienceMode,
      ROOM_CAPTURE_VISUALS: "0",
    },
    { continueOnFailure: true },
  );
}

function releaseCommand({
  binary = process.execPath,
  arguments_,
  environment = {},
  label,
}) {
  return { binary, arguments_, environment, label };
}

async function runConcurrentReleaseCommands(commands, { label, timeoutMs }) {
  const started = performance.now();
  let phaseStatus = "failed";
  const children = new Set();
  let firstFailure = null;
  let timedOut = false;
  const usesProcessGroups = process.platform !== "win32";

  const processGroupsFor = (rootPid) => {
    if (!usesProcessGroups || !rootPid) return [];
    const table = spawnSync("ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
    });
    if (table.status !== 0 || typeof table.stdout !== "string") return [rootPid];
    const records = table.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/u).map(Number))
      .filter(([pid, parentPid, groupId]) =>
        [pid, parentPid, groupId].every(Number.isSafeInteger),
      );
    const descendants = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, parentPid] of records) {
        if (!descendants.has(parentPid) || descendants.has(pid)) continue;
        descendants.add(pid);
        changed = true;
      }
    }
    return [
      ...new Set(
        records
          .filter(([pid]) => descendants.has(pid))
          .map(([, , groupId]) => groupId)
          .filter((groupId) => groupId > 1),
      ),
    ];
  };

  const signalGroups = (child, groups, name) => {
    if (!usesProcessGroups) {
      if (child.exitCode === null && !child.killed) child.kill(name);
      return;
    }
    for (const groupId of groups) {
      try {
        process.kill(-groupId, name);
      } catch (error) {
        // A process group can exit between discovery and signal delivery.
        if (error?.code !== "ESRCH") throw error;
      }
    }
  };

  const stop = (child) => {
    if (child.exitCode !== null || child.killed) return;
    // Playwright starts Wrangler in its own process group. Discover every
    // descendant group before terminating the Playwright parent so Wrangler
    // and workerd cannot be reparented and left holding HTTP/inspector ports.
    const groups = processGroupsFor(child.pid);
    signalGroups(child, groups, "SIGTERM");
    const force = setTimeout(() => {
      signalGroups(child, groups, "SIGKILL");
    }, 5_000);
    force.unref();
  };
  const stopAll = (except = null) => {
    for (const child of children) {
      if (child !== except) stop(child);
    }
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    stopAll();
  }, timeoutMs);
  timeout.unref();

  try {
    const statuses = await Promise.all(
      commands.map(
        (command) =>
          new Promise((resolve, reject) => {
            const child = spawn(command.binary, command.arguments_, {
              cwd: root,
              detached: usesProcessGroups,
              env: { ...process.env, ...command.environment },
              stdio: "inherit",
            });
            children.add(child);
            child.once("error", (error) => {
              children.delete(child);
              if (!firstFailure) firstFailure = command.label;
              stopAll(child);
              reject(error);
            });
            child.once("close", (code, signal) => {
              children.delete(child);
              const status = code ?? (signal ? 1 : 0);
              if (status !== 0 && !firstFailure && !timedOut) {
                firstFailure = command.label;
                stopAll(child);
              }
              resolve(status);
            });
          }),
      ),
    );
    if (timedOut) {
      throw new Error(`${label} exceeded its ${Math.round(timeoutMs / 60_000)} minute deadline.`);
    }
    if (statuses.some((status) => status !== 0)) {
      throw new Error(`${firstFailure ?? label} failed; remaining release checks were cancelled.`);
    }
    phaseStatus = "passed";
  } finally {
    phaseResults.push({ label, status: phaseStatus, durationMs: Math.round(performance.now() - started) });
    clearTimeout(timeout);
    stopAll();
  }
}

function releasePlaywrightCommand({
  port,
  segment,
  arguments_,
  config = "playwright.config.mjs",
  simulationExperienceMode = "disabled",
  travelAtlasMode = "atlas-v1",
  workers = 1,
}) {
  const relativeStateDirectory = `.wrangler/browser-quality-room-${segment}`;
  rmSync(path.join(root, relativeStateDirectory), { force: true, recursive: true });
  return releaseCommand({
    label: segment,
    arguments_: [
      "node_modules/@playwright/test/cli.js",
      "test",
      ...arguments_,
      "--config",
      config,
      `--workers=${workers}`,
      "--retries=0",
      "--max-failures=1",
    ],
    environment: {
      BROWSER_QUALITY_PORT: String(port),
      BROWSER_QUALITY_SEGMENT: segment,
      BROWSER_QUALITY_STATE_DIR: relativeStateDirectory,
      BROWSER_QUALITY_RELEASE: "1",
      BROWSER_SIMULATION_EXPERIENCE_MODE: simulationExperienceMode,
      BROWSER_TRAVEL_ATLAS_MODE: travelAtlasMode,
      ROOM_CAPTURE_VISUALS: "0",
    },
  });
}

const releaseStressPattern = [
  "twenty real drags never open an object",
  "twenty real Canvas pin clicks",
  "Pocket Room rejects twenty 3D swipe activations",
  "Pocket Room activates every object",
  "Pocket Room ignores idle gaps",
  "sustained slow completed fisheye frames",
].join("|");

async function runReleaseBrowserGate() {
  const coveragePath = process.env.BROWSER_RELEASE_COVERAGE_PATH;
  const coverage = coveragePath ? verifyCoverage(JSON.parse(await readFile(coveragePath, "utf8"))) : null;
  if (coverage && coverage.candidateSha !== process.env.RELEASE_VALIDATED_SHA) throw new Error("Browser coverage does not match the candidate SHA.");
  if (coverage) {
    const actual = changesBetween(root, coverage.baseSha, coverage.candidateSha);
    for (const field of ["paths", "metadataOnlyPaths"]) {
      if (JSON.stringify(actual[field].sort()) !== JSON.stringify(coverage[field])) throw new Error("Coverage differs from the actual Git change set.");
    }
  }
  // No range is not permission to skip anything. Local/full checks stay conservative.
  const scopes = coverage?.scopes ?? ["critical", "public", "objects", "room", "travel"];
  browserCoverage = coverage ?? { scopes, mode: "conservative-full" };
  browserIdentity = await validationIdentity(root, "browser", browserCoverage);
  const files = [
    "tests/browser/release-critical.spec.mjs",
    ...(scopes.includes("public") ? ["tests/browser/public-quality.spec.mjs", "tests/browser/balanced-portfolio.spec.mjs"] : []),
    ...(scopes.includes("objects") ? ["tests/browser/object-screens.spec.mjs"] : []),
    ...(scopes.includes("room") ? ["tests/browser/room-quality.spec.mjs", "tests/browser/room-art-direction.spec.mjs"] : []),
    ...(scopes.includes("travel") ? ["tests/browser/travel-atlas.spec.mjs"] : []),
  ];
  await runConcurrentReleaseCommands(
    [
      releasePlaywrightCommand({
        port: 4174,
        segment: "release-public",
        workers: 2,
        arguments_: [
          ...files,
          "tests/browser/release-config.spec.mjs",
          "--fully-parallel",
          "--grep-invert",
          releaseStressPattern,
        ],
      }),
    ],
    { label: "Critical Chromium coverage", timeoutMs: 525_000 },
  );

  if (coverage && (coverage.modes.simulationExperienceMode !== "disabled" || coverage.modes.travelAtlasMode !== "atlas-v1")) {
    await runConcurrentReleaseCommands([releasePlaywrightCommand({
      port: 4182, segment: "release-feature-modes",
      simulationExperienceMode: coverage.modes.simulationExperienceMode,
      travelAtlasMode: coverage.modes.travelAtlasMode,
      arguments_: ["tests/browser/release-config.spec.mjs"],
    })], { label: "Candidate feature configuration", timeoutMs: 60_000 });
  }

  if (scopes.includes("simulation")) {
    await runConcurrentReleaseCommands([releasePlaywrightCommand({
      port: 4180, segment: "release-simulation", simulationExperienceMode: "campaign-v1",
      arguments_: ["tests/browser/simulation-quality.spec.mjs"],
    })], { label: "Enabled Simulation coverage", timeoutMs: 525_000 });
  }

  if (!coverage || coverage.webkit) {
  await runConcurrentReleaseCommands(
    [
      releasePlaywrightCommand({
        port: 4191,
        segment: "release-spotify-webkit",
        config: "playwright.spotify-webkit.config.mjs",
        arguments_: [
          "tests/browser/public-quality.spec.mjs",
          "--grep",
          "Spotify rank navigation and consent remain keyboard-first",
        ],
      }),
    ],
    { label: "WebKit Spotify coverage", timeoutMs: 75_000 },
  );
  }

  // Linux WebKit and Lighthouse each launch their own browser and Worker.
  // Starting both simultaneously on the bounded ARM64 runner can cancel
  // WebKit's provisional navigation before either product assertion runs.
  if (!coverage || coverage.lighthouseRoutes.length) await runConcurrentReleaseCommands(
    [
      releaseCommand({
        label: "Lighthouse budgets",
        arguments_: ["scripts/run-lighthouse-quality.mjs"],
        environment: { BROWSER_QUALITY_RELEASE: "1", ...(coverage ? { LIGHTHOUSE_ROUTES: JSON.stringify(coverage.lighthouseRoutes) } : {}) },
      }),
    ],
    { label: "Lighthouse coverage", timeoutMs: 3 * 60_000 },
  );
  if (JSON.stringify(await validationIdentity(root, "browser", browserCoverage)) !== JSON.stringify(browserIdentity)) {
    throw new Error("Browser-tested artifact or inputs changed during execution.");
  }
}

const scope = process.env.BROWSER_QUALITY_SCOPE?.trim() || "release";
const allowedScopes = new Set([
  "release",
  "all",
  "public",
  "room-public",
  "room-smoke",
  "room-pr",
  "room-shard",
  "simulation",
  "travel",
  "lighthouse",
]);
if (!allowedScopes.has(scope)) {
  throw new Error(
    `BROWSER_QUALITY_SCOPE must be one of ${[...allowedScopes].join(", ")}.`,
  );
}

const configuredShard = process.env.BROWSER_QUALITY_SHARD?.trim() ?? "";
if (scope === "room-shard" && !/^[1-5]$/.test(configuredShard)) {
  throw new Error("BROWSER_QUALITY_SHARD must be an integer from 1 through 5.");
}
if (scope !== "room-shard" && configuredShard) {
  throw new Error(
    "BROWSER_QUALITY_SHARD is valid only when BROWSER_QUALITY_SCOPE=room-shard.",
  );
}

let failed = false;

if (scope === "release") {
  let status = "passed";
  try {
    await runReleaseBrowserGate();
  } catch (error) {
    status = "failed";
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    await mkdir(path.join(root, ".wrangler"), { recursive: true });
    const report = { status, identity: browserIdentity, coverage: browserCoverage, phases: phaseResults };
    await writeFile(path.join(root, ".wrangler/browser-quality-timing.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  }
  process.exit(status === "passed" ? 0 : 1);
}

if (
  (scope === "all" || scope === "public" || scope === "room-public") &&
  runPlaywright({
    port: 4174,
    segment: "public",
    arguments_: ["tests/browser/public-quality.spec.mjs", "tests/browser/balanced-portfolio.spec.mjs", "tests/browser/object-screens.spec.mjs"],
  }) !== 0
) {
  failed = true;
}

if (
  scope === "room-smoke" &&
  runPlaywright({
    port: 4175,
    segment: "room-smoke",
    arguments_: [
      "tests/browser/room-quality.spec.mjs",
      "tests/browser/room-art-direction.spec.mjs",
      "--grep-invert",
      releaseStressPattern,
      "--max-failures=1",
    ],
  }) !== 0
) {
  failed = true;
}

if (
  (scope === "all" || scope === "travel") &&
  runPlaywright({
    port: 4181,
    segment: "travel",
    arguments_: ["tests/browser/travel-atlas.spec.mjs"],
  }) !== 0
) {
  failed = true;
}

if (scope === "all" || scope === "simulation") {
  if (
    runPlaywright({
      port: 4180,
      segment: "simulation-core",
      simulationExperienceMode: "campaign-v1",
      arguments_: [
        "tests/browser/simulation-quality.spec.mjs",
        "--grep-invert",
        "without JavaScript|room reveal",
      ],
    }) !== 0
  ) {
    failed = true;
  }
  if (
    runPlaywright({
      port: 4186,
      segment: "simulation-fallbacks",
      simulationExperienceMode: "campaign-v1",
      arguments_: [
        "tests/browser/simulation-quality.spec.mjs",
        "--grep",
        "without JavaScript|room reveal",
      ],
    }) !== 0
  ) {
    failed = true;
  }
}

const roomShardCount = 5;
const prRoomShardCount = 2;
const activeRoomShardCount = scope === "room-pr" ? prRoomShardCount : roomShardCount;
const firstRoomShard = scope === "room-shard" ? Number(configuredShard) : 1;
const lastRoomShard = scope === "room-shard" ? firstRoomShard : activeRoomShardCount;
if (scope === "all" || scope === "room-shard" || scope === "room-pr") {
  for (let shard = firstRoomShard; shard <= lastRoomShard; shard += 1) {
    if (
      runPlaywright({
        port: 4174 + shard,
        segment: `quality-shard-${shard}`,
        arguments_: [
          "tests/browser/room-quality.spec.mjs",
          "tests/browser/room-art-direction.spec.mjs",
          "--fully-parallel",
          `--shard=${shard}/${activeRoomShardCount}`,
        ],
      }) !== 0
    ) {
      failed = true;
    }
  }
}

if (
  (scope === "all" || scope === "lighthouse") &&
  run(
    process.execPath,
    ["scripts/run-lighthouse-quality.mjs"],
    {},
    { continueOnFailure: true },
  ) !== 0
) {
  failed = true;
}

if (failed) process.exit(1);
