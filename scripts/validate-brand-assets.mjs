import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const { parseBrandAssetRegistry } = await tsImport(
  "../lib/brand-assets.ts",
  import.meta.url,
);

export const BRAND_ASSET_LIMITS = Object.freeze({
  maxSvgBytes: 256 * 1024,
  maxPngBytes: 512 * 1024,
  maxPngInflatedBytes: 32 * 1024 * 1024,
  maxDimension: 8192,
  maxPixels: 16_777_216,
  maxTotalBytes: 1024 * 1024,
});

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_ALLOWED_ANCILLARY_CHUNKS = new Set([
  "cHRM",
  "gAMA",
  "iCCP",
  "sRGB",
  "tRNS",
]);
const PNG_METADATA_OR_ANIMATION_CHUNKS = new Set([
  "acTL",
  "fcTL",
  "fdAT",
  "eXIf",
  "iTXt",
  "pHYs",
  "sPLT",
  "tEXt",
  "tIME",
  "zTXt",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= 0.0001;
}

function readSvgNumber(attribute) {
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:px)?$/u.exec(attribute.trim());
  return match ? Number(match[1]) : null;
}

function quotedAttribute(element, name) {
  const pattern = new RegExp(
    `(?:^|\\s)${name.replace(":", "\\:")}\\s*=\\s*(["'])(.*?)\\1`,
    "iu",
  );
  return pattern.exec(element)?.[2] ?? null;
}

function validateSvg(bytes, asset) {
  const errors = [];
  if (bytes.length > BRAND_ASSET_LIMITS.maxSvgBytes) {
    errors.push(`exceeds ${BRAND_ASSET_LIMITS.maxSvgBytes} SVG bytes`);
    return errors;
  }

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return ["is not valid UTF-8 SVG text"];
  }

  const normalized = source.replace(/^\uFEFF/u, "");
  const rootMatch = /^\s*(<svg\b[^>]*>)/iu.exec(normalized);
  if (!rootMatch || !/<\/svg>\s*$/iu.test(normalized)) {
    errors.push("must contain one complete SVG root and no leading markup");
    return errors;
  }
  if ((normalized.match(/<svg\b/giu) ?? []).length !== 1) {
    errors.push("must contain exactly one SVG root");
  }

  const forbiddenPatterns = [
    [/<\?/u, "processing instructions"],
    [/<!DOCTYPE\b/iu, "DOCTYPE declarations"],
    [/<!ENTITY\b/iu, "entity declarations"],
    [/&(?:#x?[0-9a-f]+|[a-z][\w.-]*);/iu, "entity references"],
    [/<(?:[a-z_][\w.-]*:)?(?:script|style|foreignObject|image|iframe|object|embed|audio|video|a)\b/iu, "active or embedded elements"],
    [/<(?:[a-z_][\w.-]*:)?(?:animate|animateMotion|animateTransform|set)\b/iu, "animation elements"],
    [/\s(?:[a-z_][\w.-]*:)?style\s*=/iu, "inline styles"],
    [/\s(?:[a-z_][\w.-]*:)?on[a-z][\w:.-]*\s*=/iu, "event handlers"],
    [/@import\b/iu, "CSS imports"],
    [/@font-face\b/iu, "remote font declarations"],
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(normalized)) errors.push(`contains forbidden ${label}`);
  }

  const hrefPattern = /\s(?:[a-z_][\w.-]*:)?href\s*=\s*(["'])(.*?)\1/giu;
  for (const match of normalized.matchAll(hrefPattern)) {
    if (!/^#[a-z_][\w:.-]*$/iu.test(match[2])) {
      errors.push("contains a nonlocal href reference");
      break;
    }
  }
  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
  for (const match of normalized.matchAll(urlPattern)) {
    if (!/^#[a-z_][\w:.-]*$/iu.test(match[2])) {
      errors.push("contains a nonlocal URL reference");
      break;
    }
  }

  const root = rootMatch[1];
  const widthValue = quotedAttribute(root, "width");
  const heightValue = quotedAttribute(root, "height");
  const viewBoxValue = quotedAttribute(root, "viewBox");
  const width = widthValue === null ? null : readSvgNumber(widthValue);
  const height = heightValue === null ? null : readSvgNumber(heightValue);
  let viewBox = null;
  if (viewBoxValue !== null) {
    const values = viewBoxValue.trim().split(/[\s,]+/u).map(Number);
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2] > 0 &&
      values[3] > 0
    ) {
      viewBox = values;
    } else {
      errors.push("has an invalid viewBox");
    }
  }

  if ((widthValue !== null && width === null) || (heightValue !== null && height === null)) {
    errors.push("uses an unsupported SVG dimension unit");
  }
  const intrinsicWidth = width ?? viewBox?.[2] ?? null;
  const intrinsicHeight = height ?? viewBox?.[3] ?? null;
  if (intrinsicWidth === null || intrinsicHeight === null) {
    errors.push("must declare intrinsic width and height or a viewBox");
  } else {
    if (
      !approximatelyEqual(intrinsicWidth, asset.width) ||
      !approximatelyEqual(intrinsicHeight, asset.height)
    ) {
      errors.push(
        `intrinsic dimensions ${intrinsicWidth}x${intrinsicHeight} do not match registry ${asset.width}x${asset.height}`,
      );
    }
    if (
      intrinsicWidth > BRAND_ASSET_LIMITS.maxDimension ||
      intrinsicHeight > BRAND_ASSET_LIMITS.maxDimension ||
      intrinsicWidth * intrinsicHeight > BRAND_ASSET_LIMITS.maxPixels
    ) {
      errors.push("exceeds SVG dimension or pixel bounds");
    }
  }
  if (width !== null && height !== null && viewBox) {
    const declaredRatio = width / height;
    const viewBoxRatio = viewBox[2] / viewBox[3];
    if (Math.abs(declaredRatio - viewBoxRatio) / viewBoxRatio > 0.005) {
      errors.push("width and height do not preserve the viewBox aspect ratio");
    }
  }

  return errors;
}

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngBitsPerPixel(bitDepth, colorType) {
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(colorType);
  const allowedDepths = new Map([
    [0, new Set([1, 2, 4, 8, 16])],
    [2, new Set([8, 16])],
    [3, new Set([1, 2, 4, 8])],
    [4, new Set([8, 16])],
    [6, new Set([8, 16])],
  ]).get(colorType);
  return channels && allowedDepths?.has(bitDepth)
    ? channels * bitDepth
    : null;
}

function validatePng(bytes, asset) {
  const errors = [];
  if (bytes.length > BRAND_ASSET_LIMITS.maxPngBytes) {
    return [`exceeds ${BRAND_ASSET_LIMITS.maxPngBytes} PNG bytes`];
  }
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return ["does not have a valid PNG signature"];
  }

  let offset = 8;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      errors.push("contains a truncated PNG chunk");
      break;
    }
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      errors.push("contains a PNG chunk beyond the file boundary");
      break;
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/u.test(type)) errors.push("contains an invalid PNG chunk type");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (actualCrc !== expectedCrc) errors.push(`contains an invalid ${type} CRC`);
    chunks.push({ type, data });
    offset = end;
    if (type === "IEND") break;
  }
  if (offset !== bytes.length) errors.push("contains data after the PNG IEND chunk");
  if (chunks[0]?.type !== "IHDR" || chunks.at(-1)?.type !== "IEND") {
    errors.push("must begin with IHDR and end with IEND");
    return errors;
  }
  if (chunks[0].data.length !== 13 || chunks.at(-1).data.length !== 0) {
    errors.push("contains malformed IHDR or IEND data");
    return errors;
  }

  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filter = ihdr[11];
  const interlace = ihdr[12];
  const bitsPerPixel = pngBitsPerPixel(bitDepth, colorType);
  if (
    !width ||
    !height ||
    width > BRAND_ASSET_LIMITS.maxDimension ||
    height > BRAND_ASSET_LIMITS.maxDimension ||
    width * height > BRAND_ASSET_LIMITS.maxPixels
  ) {
    errors.push("exceeds PNG dimension or pixel bounds");
  }
  if (width !== asset.width || height !== asset.height) {
    errors.push(
      `intrinsic dimensions ${width}x${height} do not match registry ${asset.width}x${asset.height}`,
    );
  }
  if (!bitsPerPixel || compression !== 0 || filter !== 0 || interlace !== 0) {
    errors.push("uses an unsupported PNG color, compression, filter, or interlace mode");
  }

  let sawPlte = false;
  let sawIdat = false;
  let idatEnded = false;
  const idat = [];
  for (const { type, data } of chunks.slice(1, -1)) {
    if (PNG_METADATA_OR_ANIMATION_CHUNKS.has(type)) {
      errors.push(`contains forbidden PNG metadata or animation chunk ${type}`);
      continue;
    }
    if (type === "PLTE") {
      if (sawPlte || sawIdat || data.length === 0 || data.length % 3 !== 0) {
        errors.push("contains an invalid PNG palette");
      }
      sawPlte = true;
      continue;
    }
    if (type === "IDAT") {
      if (idatEnded) errors.push("contains nonconsecutive PNG IDAT chunks");
      sawIdat = true;
      idat.push(data);
      continue;
    }
    if (sawIdat) idatEnded = true;
    if (!PNG_ALLOWED_ANCILLARY_CHUNKS.has(type)) {
      errors.push(`contains unsupported PNG chunk ${type}`);
    }
  }
  if (!sawIdat || (colorType === 3 && !sawPlte)) {
    errors.push("is missing required PNG image data or palette");
  }

  const dimensionsAreBounded =
    width > 0 &&
    height > 0 &&
    width <= BRAND_ASSET_LIMITS.maxDimension &&
    height <= BRAND_ASSET_LIMITS.maxDimension &&
    width * height <= BRAND_ASSET_LIMITS.maxPixels;
  if (bitsPerPixel && idat.length && dimensionsAreBounded) {
    try {
      const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
      const expectedLength = height * (rowBytes + 1);
      if (expectedLength > BRAND_ASSET_LIMITS.maxPngInflatedBytes) {
        errors.push("exceeds the PNG decompression budget");
        return errors;
      }
      const pixels = inflateSync(Buffer.concat(idat), {
        maxOutputLength: expectedLength,
      });
      if (pixels.length !== expectedLength) {
        errors.push("has a malformed PNG decompressed data length");
      } else {
        for (let row = 0; row < height; row += 1) {
          if (pixels[row * (rowBytes + 1)] > 4) {
            errors.push("contains an invalid PNG row filter");
            break;
          }
        }
      }
    } catch {
      errors.push("contains invalid compressed PNG image data");
    }
  }

  return errors;
}

function sourceFixtureExtension(asset) {
  return asset.mediaType === "image/svg+xml" ? "svg" : "png";
}

function stripOfficialSvgTransportMarkup(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return Buffer.from(
    source
      .replace(/^\uFEFF/u, "")
      .replace(/^\s*<\?xml\s+[^?]*\?>\s*/iu, ""),
  );
}

function stripOfficialPngMetadata(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  const kept = [bytes.subarray(0, 8)];
  let offset = 8;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (!PNG_METADATA_OR_ANIMATION_CHUNKS.has(type)) {
      kept.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  return sawIend && offset === bytes.length ? Buffer.concat(kept) : null;
}

function expectedDeployedBytes(sourceBytes, asset) {
  return asset.mediaType === "image/svg+xml"
    ? stripOfficialSvgTransportMarkup(sourceBytes)
    : stripOfficialPngMetadata(sourceBytes);
}

async function organizationDirectoryFiles(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readRequiredJson(filePath, label, errors) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: missing, unreadable, or invalid JSON (${reason})`);
    return null;
  }
}

function validateBrandAssetReferences(
  registry,
  careerManifest,
  workOrganizationsManifest,
) {
  const errors = [];
  const registryIds = new Set(registry.assets.map(({ id }) => id));
  const referencedIds = new Set();

  if (
    !careerManifest ||
    typeof careerManifest !== "object" ||
    Array.isArray(careerManifest) ||
    careerManifest.schemaVersion !== "1.0" ||
    !Array.isArray(careerManifest.phases) ||
    careerManifest.phases.length === 0
  ) {
    errors.push("career.v1.json: invalid career presentation manifest");
  } else {
    careerManifest.phases.forEach((phase, index) => {
      const phaseId =
        phase && typeof phase === "object" && typeof phase.id === "string"
          ? phase.id
          : `phase-${index + 1}`;
      const mark =
        phase && typeof phase === "object" && phase.mark &&
        typeof phase.mark === "object" && !Array.isArray(phase.mark)
          ? phase.mark
          : null;
      if (!mark || (mark.kind !== "official" && mark.kind !== "typographic")) {
        errors.push(`${phaseId}: career mark must be official or typographic`);
        return;
      }
      if (mark.kind === "typographic") {
        if (mark.brandAssetId !== null) {
          errors.push(`${phaseId}: typographic career mark must use brandAssetId null`);
        }
        return;
      }
      if (typeof mark.brandAssetId !== "string" || !mark.brandAssetId) {
        errors.push(`${phaseId}: official career mark must reference a brand asset`);
        return;
      }
      referencedIds.add(mark.brandAssetId);
      if (!registryIds.has(mark.brandAssetId)) {
        errors.push(`${phaseId}: unknown brandAssetId ${mark.brandAssetId}`);
      }
    });
  }

  if (
    !workOrganizationsManifest ||
    typeof workOrganizationsManifest !== "object" ||
    Array.isArray(workOrganizationsManifest) ||
    workOrganizationsManifest.schemaVersion !== "1.0" ||
    !Array.isArray(workOrganizationsManifest.marks) ||
    workOrganizationsManifest.marks.length === 0
  ) {
    errors.push(
      "work-organizations.v1.json: invalid organization presentation manifest",
    );
  } else {
    workOrganizationsManifest.marks.forEach((mark, index) => {
      const markId =
        mark && typeof mark === "object" && typeof mark.id === "string"
          ? mark.id
          : `mark-${index + 1}`;
      if (
        !mark ||
        typeof mark !== "object" ||
        Array.isArray(mark) ||
        (mark.brandAssetId !== null && typeof mark.brandAssetId !== "string")
      ) {
        errors.push(`${markId}: organization brandAssetId must be a string or null`);
        return;
      }
      if (mark.brandAssetId === null) return;
      referencedIds.add(mark.brandAssetId);
      if (!registryIds.has(mark.brandAssetId)) {
        errors.push(`${markId}: unknown brandAssetId ${mark.brandAssetId}`);
      }
    });
  }

  for (const assetId of registryIds) {
    if (!referencedIds.has(assetId)) {
      errors.push(`${assetId}: registry asset is not referenced by a presentation manifest`);
    }
  }

  return errors;
}

export async function validateBrandAssets({
  projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  manifestPath = path.join(projectRoot, "content/presentation/brand-assets.v1.json"),
  careerManifestPath = path.join(
    projectRoot,
    "content/presentation/career.v1.json",
  ),
  workOrganizationsManifestPath = path.join(
    projectRoot,
    "content/presentation/work-organizations.v1.json",
  ),
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const errors = [];
  let registry;
  try {
    registry = parseBrandAssetRegistry(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
  } catch (error) {
    return {
      errors: [`brand-assets.v1.json: ${error instanceof Error ? error.message : String(error)}`],
      registry: null,
    };
  }

  const publicRoot = path.join(projectRoot, "public");
  const organizationDirectory = path.join(publicRoot, "assets/organizations");
  const sourceDirectory = path.join(
    projectRoot,
    "tests/fixtures/brand-assets/official-sources",
  );
  const referencedFiles = new Set();
  const referencedSourceFiles = new Set();
  let totalBytes = 0;

  const careerManifest = await readRequiredJson(
    careerManifestPath,
    "career.v1.json",
    errors,
  );
  const workOrganizationsManifest = await readRequiredJson(
    workOrganizationsManifestPath,
    "work-organizations.v1.json",
    errors,
  );
  errors.push(
    ...validateBrandAssetReferences(
      registry,
      careerManifest,
      workOrganizationsManifest,
    ),
  );

  for (const asset of registry.assets) {
    if (asset.lastVerified > today) {
      errors.push(`${asset.id}: lastVerified is in the future`);
    }
    const relativePath = asset.assetPath.slice(1);
    const filePath = path.resolve(publicRoot, relativePath);
    if (!filePath.startsWith(`${path.resolve(organizationDirectory)}${path.sep}`)) {
      errors.push(`${asset.id}: assetPath escapes the organization asset directory`);
      continue;
    }
    referencedFiles.add(path.basename(filePath));
    const sourceFileName = `${asset.id}.source.${sourceFixtureExtension(asset)}`;
    const sourceFilePath = path.resolve(sourceDirectory, sourceFileName);
    referencedSourceFiles.add(sourceFileName);

    let fileStat;
    let bytes;
    try {
      fileStat = await lstat(filePath);
      bytes = await readFile(filePath);
    } catch {
      errors.push(`${asset.id}: asset file is missing or unreadable`);
      continue;
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      errors.push(`${asset.id}: asset must be a regular non-symlink file`);
      continue;
    }
    let sourceStat;
    let sourceBytes;
    try {
      sourceStat = await lstat(sourceFilePath);
      sourceBytes = await readFile(sourceFilePath);
    } catch {
      errors.push(`${asset.id}: official source fixture is missing or unreadable`);
      continue;
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      errors.push(`${asset.id}: official source fixture must be a regular file`);
      continue;
    }
    if (sha256(sourceBytes) !== asset.sourceSha256) {
      errors.push(`${asset.id}: sourceSha256 does not match official source bytes`);
    }
    const expectedBytes = expectedDeployedBytes(sourceBytes, asset);
    if (!expectedBytes || !expectedBytes.equals(bytes)) {
      errors.push(
        `${asset.id}: deployed bytes are not the deterministic metadata-free form of the official source`,
      );
    }
    totalBytes += bytes.length;
    const digest = sha256(bytes);
    if (digest !== asset.deployedSha256) {
      errors.push(`${asset.id}: deployedSha256 does not match asset bytes`);
    }

    const assetErrors = asset.mediaType === "image/svg+xml"
      ? validateSvg(bytes, asset)
      : validatePng(bytes, asset);
    for (const error of assetErrors) errors.push(`${asset.id}: ${error}`);
  }

  if (totalBytes > BRAND_ASSET_LIMITS.maxTotalBytes) {
    errors.push(`organization assets exceed ${BRAND_ASSET_LIMITS.maxTotalBytes} total bytes`);
  }

  const entries = await organizationDirectoryFiles(organizationDirectory);
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      errors.push(`assets/organizations/${entry.name}: only regular files are allowed`);
    } else if (!referencedFiles.has(entry.name)) {
      errors.push(`assets/organizations/${entry.name}: orphaned asset file`);
    }
  }

  const sourceEntries = await organizationDirectoryFiles(sourceDirectory);
  for (const entry of sourceEntries) {
    if (entry.name === "README.md") continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      errors.push(`official-sources/${entry.name}: only regular files are allowed`);
    } else if (!referencedSourceFiles.has(entry.name)) {
      errors.push(`official-sources/${entry.name}: orphaned source fixture`);
    }
  }

  return { errors, registry };
}

async function main() {
  const { errors, registry } = await validateBrandAssets();
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Brand assets valid (${registry.assets.length} official assets).`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await main();
