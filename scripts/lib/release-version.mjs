import { readFile } from "node:fs/promises";
import path from "node:path";

// SemVer 2.0.0, including prerelease identifiers such as 2.0.0-rc.1.
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function exactReleaseVersion(value, name = "RELEASE_VERSION") {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    throw new Error(`${name} must be an exact SemVer 2.0.0 value.`);
  }
  return value;
}

export function matchingReleaseVersion(value, packageVersion, name = "RELEASE_VERSION") {
  const releaseVersion = exactReleaseVersion(value, name);
  const expected = exactReleaseVersion(packageVersion, "package.json version");
  if (releaseVersion !== expected) {
    throw new Error(`${name} must exactly match package.json version ${expected}.`);
  }
  return releaseVersion;
}

export function releaseBranchForVersion(value) {
  const releaseVersion = exactReleaseVersion(value);
  const stableVersion = releaseVersion.split(/[+-]/u, 1)[0];
  return `release/${stableVersion}`;
}

export function assertReleaseBranch(branch, releaseVersion) {
  const expected = releaseBranchForVersion(releaseVersion);
  if (branch !== expected) {
    throw new Error(
      `Staging release commands require branch ${expected}; received ${branch || "detached HEAD"}.`,
    );
  }
  return branch;
}

export async function readPackageReleaseVersion(root) {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  return exactReleaseVersion(packageJson.version, "package.json version");
}
