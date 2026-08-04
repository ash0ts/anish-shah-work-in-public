import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import {
  collectViteStaticDependencyClosure,
  findViteManifestEntryBySource,
  subtractManifestFiles,
} from "./lib/vite-manifest-closure.mjs";

const root = process.cwd();
const targets = [resolve(root, "dist/client"), resolve(root, "dist/server")];
const clientDirectory = resolve(root, "dist/client");
const manifestPath = resolve(clientDirectory, ".vite/manifest.json");
const ROOM_STAGE_SOURCE = "components/play/room-3d/RoomStage.tsx";
const ROOM_RUNTIME_SOURCE =
  "components/play/room-platform/RoomRuntime.tsx";
const ROOM_RENDERER_GZIP_TARGET_BYTES = 225 * 1024;
const ROOM_RENDERER_GZIP_HARD_CEILING_BYTES = 325 * 1024;
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
  ".xml",
]);
const forbidden = [
  { label: "local file URI", pattern: /file:\/\/\//i },
  { label: "macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: "Windows user path", pattern: /[A-Z]:\\Users\\[^\\]+\\/i },
  { label: "private Slack archive URL", pattern: /https?:\/\/[^\s"']+\.slack\.com\/archives\//i },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    label: "literal connector secret assignment",
    pattern: /(?:CONNECTOR_ENCRYPTION_KEY|MAL_CLIENT_SECRET|STEAM_API_KEY|HARDCOVER_API_KEY|SIMULATION_SESSION_HMAC_KEY|SIMULATION_GATEWAY_TOKEN|SIMULATION_ANTHROPIC_API_KEY)\s*=\s*[^\s"']+/i,
  },
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const violations = [];
for (const target of targets) {
  for (const path of await files(target)) {
    const name = relative(root, path);
    if (/(?:^|\/)\.env(?:\.|$)/i.test(name)) {
      violations.push(`${name}: environment file must not be deployed`);
      continue;
    }
    if (!textExtensions.has(extname(path))) continue;
    const info = await stat(path);
    if (info.size > 8 * 1024 * 1024) continue;
    const body = await readFile(path, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(body)) violations.push(`${name}: ${rule.label}`);
    }
  }
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const roomStageEntryKey = findViteManifestEntryBySource(
    manifest,
    ROOM_STAGE_SOURCE,
  );
  const roomRuntimeEntryKey = findViteManifestEntryBySource(
    manifest,
    ROOM_RUNTIME_SOURCE,
  );
  const roomStageClosure = collectViteStaticDependencyClosure(
    manifest,
    roomStageEntryKey,
  );
  const preRendererClosure = collectViteStaticDependencyClosure(
    manifest,
    roomRuntimeEntryKey,
  );
  const deferredRendererFiles = subtractManifestFiles(
    roomStageClosure.files,
    preRendererClosure.files,
  );

  async function gzipBytesFor(outputFiles) {
    let total = 0;
    for (const outputFile of outputFiles) {
      total += gzipSync(
        await readFile(resolve(clientDirectory, outputFile)),
      ).byteLength;
    }
    return total;
  }

  const [closureGzipBytes, deferredGzipBytes] = await Promise.all([
    gzipBytesFor(roomStageClosure.files),
    gzipBytesFor(deferredRendererFiles),
  ]);

  if (deferredRendererFiles.size === 0) {
    violations.push(
      "dist/client: the RoomStage manifest closure has no deferred renderer files",
    );
  }
  if (deferredGzipBytes > ROOM_RENDERER_GZIP_HARD_CEILING_BYTES) {
    violations.push(
      `dist/client: deferred RoomStage manifest closure is ${deferredGzipBytes} gzip bytes and exceeds the ${ROOM_RENDERER_GZIP_HARD_CEILING_BYTES}-byte hard ceiling`,
    );
  }

  const targetState =
    deferredGzipBytes <= ROOM_RENDERER_GZIP_TARGET_BYTES
      ? "meets"
      : "is above";
  console.log(
    `Room renderer bundle: ${deferredGzipBytes} deferred gzip bytes across ${deferredRendererFiles.size} files (${targetState} the ${ROOM_RENDERER_GZIP_TARGET_BYTES}-byte optimization target; hard ceiling ${ROOM_RENDERER_GZIP_HARD_CEILING_BYTES}); ${closureGzipBytes} gzip bytes across ${roomStageClosure.files.size} files in the complete static manifest closure.`,
  );
} catch (error) {
  violations.push(
    `dist/client: unable to validate the RoomStage manifest closure (${error instanceof Error ? error.message : "unknown error"})`,
  );
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Release bundle privacy scan passed.");
}
