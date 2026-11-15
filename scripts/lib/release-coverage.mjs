import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { classifyCiChanges } from "./ci-change-classifier.mjs";
import { exactReleaseVersion } from "./release-version.mjs";

export const COVERAGE_VERSION = 1;
export const FEATURE_KEYS = ["simulationExperienceMode", "simulationAiMode", "travelAtlasMode"];

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function assertModes(modes) {
  if (!modes || Object.keys(modes).sort().join() !== [...FEATURE_KEYS].sort().join() ||
      !["disabled", "coming-soon", "campaign-v1"].includes(modes.simulationExperienceMode) ||
      !["authored-only", "live"].includes(modes.simulationAiMode) ||
      !["disabled", "atlas-v1"].includes(modes.travelAtlasMode)) {
    throw new Error("Explicit previous and candidate feature modes are required.");
  }
}

export function versionOnlyChange(pathname, before, after) {
  if (!["package.json", "package-lock.json"].includes(pathname)) return false;
  try {
    const a = JSON.parse(before), b = JSON.parse(after);
    if (a.version === b.version) return false;
    exactReleaseVersion(b.version);
    delete a.version; delete b.version;
    if (pathname === "package-lock.json") {
      if (!a.packages?.[""] || !b.packages?.[""]) return false;
      delete a.packages[""].version; delete b.packages[""].version;
    }
    return JSON.stringify(a) === JSON.stringify(b);
  } catch { return false; }
}

export function gitRead(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Cannot inspect Git range: ${result.stderr || result.error?.message}`);
  return result.stdout;
}

export function changesBetween(root, baseSha, candidateSha) {
  for (const sha of [baseSha, candidateSha]) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Coverage requires full deployed and candidate SHAs.");
  }
  gitRead(root, ["merge-base", "--is-ancestor", baseSha, candidateSha]);
  const paths = gitRead(root, ["diff", "--name-only", "--no-renames", "--no-ext-diff", "--no-textconv", "-z", baseSha, candidateSha, "--"]).split("\0").filter(Boolean);
  const metadataOnlyPaths = paths.filter((pathname) => {
    if (!["package.json", "package-lock.json"].includes(pathname)) return false;
    try { return versionOnlyChange(pathname, gitRead(root, ["show", `${baseSha}:${pathname}`]), gitRead(root, ["show", `${candidateSha}:${pathname}`])); }
    catch { return false; }
  });
  if (metadataOnlyPaths.length) {
    try {
      const pkg = JSON.parse(gitRead(root, ["show", `${candidateSha}:package.json`]));
      const lock = JSON.parse(gitRead(root, ["show", `${candidateSha}:package-lock.json`]));
      if (pkg.version !== lock.version || pkg.version !== lock.packages?.[""].version) metadataOnlyPaths.length = 0;
    } catch { metadataOnlyPaths.length = 0; }
  }
  return { paths, metadataOnlyPaths };
}

export function releaseCoverage({ baseSha, candidateSha, paths, metadataOnlyPaths = [], previousModes, modes }) {
  for (const sha of [baseSha, candidateSha]) if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Coverage requires exact SHAs.");
  assertModes(previousModes); assertModes(modes);
  const classification = paths.length ? classifyCiChanges(paths, { metadataOnlyPaths }) : { lane: "metadata", areas: [], browserScopes: [] };
  const modeChange = FEATURE_KEYS.some((key) => previousModes[key] !== modes[key]);
  const full = classification.lane === "full" || modeChange;
  const areas = new Set(classification.areas);
  const publicUi = full || ["copy", "ui"].includes(classification.lane) || areas.has("ui");
  const room = full || areas.has("room");
  const objects = full || areas.has("play") || room;
  const travel = modes.travelAtlasMode === "atlas-v1" && (full || areas.has("travel"));
  const simulation = modes.simulationExperienceMode === "campaign-v1" && (full || areas.has("simulation"));
  const scopes = ["critical", ...(publicUi ? ["public"] : []), ...(objects ? ["objects"] : []), ...(room ? ["room"] : []), ...(travel ? ["travel"] : []), ...(simulation ? ["simulation"] : [])];
  const plan = {
    schemaVersion: COVERAGE_VERSION, baseSha, candidateSha,
    paths: [...paths].sort(), metadataOnlyPaths: [...metadataOnlyPaths].sort(),
    previousModes, modes, lane: classification.lane, scopes,
    webkit: objects || publicUi,
    lighthouseRoutes: full ? ["/", "/work", "/play", "/sources", "/privacy"] : publicUi ? ["/", "/work", "/sources"] : room || objects ? ["/play"] : [],
  };
  return { ...plan, coverageSha256: digest(plan) };
}

export function verifyCoverage(plan) {
  const expected = releaseCoverage(plan);
  if (JSON.stringify(expected) !== JSON.stringify(plan)) throw new Error("Release coverage is incomplete or has been changed.");
  return plan;
}
