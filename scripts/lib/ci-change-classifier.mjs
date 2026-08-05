import path from "node:path";

const COPY_METADATA = new Set([
  ".github/PULL_REQUEST_TEMPLATE/copy-change.md",
]);

function normalizeChangedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("CI change paths must be non-empty strings.");
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.split("/").includes("..") ||
    path.posix.normalize(normalized) !== normalized
  ) {
    throw new Error(`CI change path is not repository-relative: ${value}`);
  }
  return normalized;
}

function isDocs(pathname) {
  return (
    pathname.startsWith("docs/") ||
    pathname.startsWith("releases/") ||
    pathname === "README.md" ||
    pathname === "AGENTS.md" ||
    pathname === "CONTRIBUTING.md" ||
    pathname === "SECURITY.md" ||
    pathname === ".github/pull_request_template.md" ||
    (pathname.startsWith(".agents/") &&
      /\.(?:md|ya?ml)$/u.test(pathname))
  );
}

function isCopy(pathname) {
  return pathname.startsWith("content/copy/") || COPY_METADATA.has(pathname);
}

function isFull(pathname) {
  return (
    pathname === "package.json" ||
    pathname === "package-lock.json" ||
    pathname === ".node-version" ||
    pathname.startsWith(".github/actions/") ||
    pathname.startsWith(".github/workflows/") ||
    pathname.startsWith(".github/runner/") ||
    pathname.startsWith("drizzle/") ||
    pathname.startsWith("scripts/ci/") ||
    pathname.startsWith("scripts/runner/") ||
    /(?:^|\/)(?:release|staging|hosted|deployable|preview)-(?:[^/]+)\.mjs$/u.test(
      pathname,
    )
  );
}

function isSimulation(pathname) {
  return (
    pathname.startsWith("app/simulation/") ||
    pathname.startsWith("app/api/simulation/") ||
    pathname.startsWith("components/simulation/") ||
    pathname.startsWith("components/experience-audio/") ||
    pathname.startsWith("lib/server/simulation/") ||
    pathname.startsWith("content/simulation/") ||
    pathname.startsWith("types/simulation") ||
    pathname.includes("simulation")
  );
}

function isTravel(pathname) {
  return (
    pathname.startsWith("app/play/travel/") ||
    pathname.startsWith("app/api/travel/") ||
    pathname.startsWith("app/api/travel-media/") ||
    pathname.startsWith("app/api/studio/travel/") ||
    pathname.startsWith("components/play/travel/") ||
    pathname.startsWith("components/studio/travel/") ||
    pathname.startsWith("lib/server/travel/") ||
    pathname.startsWith("public/assets/travel/") ||
    pathname.startsWith("scripts/travel/") ||
    pathname.startsWith("types/travel") ||
    pathname.includes("travel")
  );
}

function isRoom(pathname) {
  return (
    pathname.startsWith("components/play/room-3d/") ||
    pathname.startsWith("components/play/room/") ||
    pathname.startsWith("components/play/pocket-room/") ||
    pathname.startsWith("components/play/room-platform/") ||
    pathname === "app/play/page.tsx" ||
    pathname === "app/play/layout.tsx" ||
    pathname.includes("room")
  );
}

function isPlayObject(pathname) {
  return (
    pathname.startsWith("app/play/") ||
    pathname.startsWith("components/play/") ||
    pathname.startsWith("components/Spotify") ||
    pathname.startsWith("components/PersonalStreams")
  );
}

function isBackend(pathname) {
  return (
    pathname.startsWith("app/api/") ||
    pathname.startsWith("lib/server/") ||
    pathname.startsWith("worker/") ||
    pathname.startsWith("types/connectors") ||
    pathname.includes("connector") ||
    pathname.includes("oauth") ||
    pathname.includes("security")
  );
}

function isUserInterface(pathname) {
  return (
    (pathname.startsWith("app/") && !pathname.startsWith("app/api/")) ||
    pathname.startsWith("components/") ||
    pathname.startsWith("public/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".tsx")
  );
}

function browserScopesFor(areas) {
  const scopes = [];
  const specialized =
    areas.has("room") || areas.has("simulation") || areas.has("travel");
  if (!specialized && areas.has("ui")) {
    scopes.push("public");
  }
  if (areas.has("play")) scopes.push("public");
  if (areas.has("room")) scopes.push("public", "room-smoke");
  if (areas.has("simulation")) scopes.push("simulation");
  if (areas.has("travel")) scopes.push("travel");
  return [...new Set(scopes)];
}

export function classifyCiChanges(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("CI change classification requires at least one path.");
  }
  const paths = [...new Set(inputPaths.map(normalizeChangedPath))].sort();

  if (paths.every(isDocs)) {
    return {
      lane: "docs",
      paths,
      areas: ["docs"],
      requiresBuild: false,
      browserScopes: [],
      requiresCodeql: false,
    };
  }

  if (paths.every((pathname) => isCopy(pathname))) {
    return {
      lane: "copy",
      paths,
      areas: ["copy"],
      requiresBuild: false,
      browserScopes: [],
      requiresCodeql: false,
    };
  }

  const areas = new Set();
  for (const pathname of paths) {
    if (isFull(pathname)) areas.add("full");
    else if (isTravel(pathname)) areas.add("travel");
    else if (isSimulation(pathname)) areas.add("simulation");
    else if (isRoom(pathname)) areas.add("room");
    else if (isPlayObject(pathname)) areas.add("play");
    else if (isBackend(pathname)) areas.add("backend");
    else if (isUserInterface(pathname)) areas.add("ui");
  }
  if (areas.size === 0) areas.add("full");

  const specializedAreas = ["room", "simulation", "travel"].filter((area) =>
    areas.has(area),
  );
  const crossDomain =
    specializedAreas.length > 1 ||
    (specializedAreas.length === 1 && areas.size > 1) ||
    (areas.has("play") && areas.has("backend"));
  let lane;
  if (areas.has("full") || crossDomain) lane = "full";
  else if (areas.has("travel")) lane = "travel";
  else if (areas.has("simulation")) lane = "simulation";
  else if (areas.has("room")) lane = "room";
  else if (areas.has("ui") || areas.has("play")) lane = "ui";
  else lane = "backend";

  const browserScopes = browserScopesFor(areas);
  return {
    lane,
    paths,
    areas: [...areas].sort(),
    requiresBuild: !["docs", "copy", "backend"].includes(lane),
    browserScopes,
    requiresCodeql:
      lane === "full" ||
      areas.has("backend") ||
      paths.some((pathname) =>
        /(?:auth|oauth|security|worker|workflow|package-lock)/u.test(pathname),
      ),
  };
}

export function pathsFromPullRequestFiles(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 3000) {
    throw new Error("Pull-request file metadata must contain 1–3000 records.");
  }
  const paths = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Pull-request file metadata contains an invalid record.");
    }
    const filename = normalizeChangedPath(record.filename);
    paths.push(filename);
    if (record.status === "renamed") {
      if (typeof record.previous_filename !== "string") {
        throw new Error("Renamed pull-request files require previous_filename.");
      }
      paths.push(normalizeChangedPath(record.previous_filename));
    }
  }
  return [...new Set(paths)].sort();
}
