import { quantizePublicCoordinate } from "./contracts";
import type { TravelPublicPoint } from "./contracts";

export const TRAVEL_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const MAX_TRAVEL_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_TRAVEL_PHOTO_PIXELS = 100_000_000;

export type LocalPhotoSuggestion = {
  capturedAt: string | null;
  publicPoint: TravelPublicPoint | null;
  source: "jpeg-exif" | "file-date" | "none";
};

export type LocalPhotoCandidate = {
  localId: string;
  file: File;
  previewSrc: string;
  width: number;
  height: number;
  suggestion: LocalPhotoSuggestion;
  placeId: string;
  altText: string;
  caption: string;
  tags: string;
  capturedAt: string;
  isCover: boolean;
  phase: "queued" | "uploading" | "failed";
  error: string | null;
};

type TiffView = {
  view: DataView;
  bytes: Uint8Array;
  tiffOffset: number;
  littleEndian: boolean;
};

export async function createLocalPhotoCandidate(
  file: File,
  ordinal: number,
): Promise<LocalPhotoCandidate> {
  if (!TRAVEL_PHOTO_TYPES.includes(file.type as (typeof TRAVEL_PHOTO_TYPES)[number])) {
    throw new Error("Use JPEG, PNG, WebP, or HEIC photos.");
  }
  if (file.size <= 0 || file.size > MAX_TRAVEL_PHOTO_BYTES) {
    throw new Error("Each photo must be larger than zero bytes and no more than 20 MB.");
  }

  const previewSrc = URL.createObjectURL(file);
  try {
    const dimensions = await readDimensions(file);
    if (dimensions.width * dimensions.height > MAX_TRAVEL_PHOTO_PIXELS) {
      throw new Error("This photo is too large to process safely.");
    }
    const suggestion = await readLocalPhotoSuggestion(file);
    return {
      localId: createLocalId(ordinal),
      file,
      previewSrc,
      width: dimensions.width,
      height: dimensions.height,
      suggestion,
      placeId: "",
      altText: "",
      caption: "",
      tags: "",
      capturedAt: suggestion.capturedAt ?? "",
      isCover: ordinal === 0,
      phase: "queued",
      error: null,
    };
  } catch (error) {
    URL.revokeObjectURL(previewSrc);
    throw error;
  }
}

export function disposeLocalPhotoCandidate(
  candidate: Pick<LocalPhotoCandidate, "previewSrc">,
): void {
  URL.revokeObjectURL(candidate.previewSrc);
}

export function parseTagInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

export function suggestedPlaceGroup(
  suggestion: LocalPhotoSuggestion,
): string {
  if (!suggestion.publicPoint) return "Unlocated photos";
  const { lat, lng } = suggestion.publicPoint;
  return `Near ${lat.toFixed(1)}°, ${lng.toFixed(1)}°`;
}

async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height };
    } catch {
      // Safari can decode some camera formats through an image element even
      // when createImageBitmap does not support them.
    } finally {
      bitmap?.close();
    }
  }
  return readImageElementDimensions(file);
}

async function readImageElementDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  if (typeof Image === "undefined") {
    throw new Error("This browser cannot inspect the photo safely.");
  }
  const source = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        } else {
          reject(new Error("This photo has invalid dimensions."));
        }
      };
      image.onerror = () => reject(new Error("This photo could not be decoded in the browser."));
      image.src = source;
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function readLocalPhotoSuggestion(
  file: File,
): Promise<LocalPhotoSuggestion> {
  if (file.type !== "image/jpeg") {
    return fileDateSuggestion(file);
  }

  try {
    const buffer = await file.arrayBuffer();
    const tiff = locateExifTiff(buffer);
    if (!tiff) return fileDateSuggestion(file);
    const root = readIfd(tiff, readUint32(tiff, tiff.tiffOffset + 4));
    const exifOffset = root.get(0x8769)?.numberValue ?? null;
    const gpsOffset = root.get(0x8825)?.numberValue ?? null;
    const exif = exifOffset === null ? new Map<number, IfdValue>() : readIfd(tiff, exifOffset);
    const gps = gpsOffset === null ? new Map<number, IfdValue>() : readIfd(tiff, gpsOffset);
    const date =
      exif.get(0x9003)?.textValue ??
      exif.get(0x9004)?.textValue ??
      root.get(0x0132)?.textValue ??
      null;
    const point = readGpsPoint(tiff, gps);
    return {
      capturedAt: normalizeExifDate(date) ?? fileDateSuggestion(file).capturedAt,
      publicPoint: point
        ? {
            lat: quantizePublicCoordinate(point.lat),
            lng: quantizePublicCoordinate(point.lng),
          }
        : null,
      source: date || point ? "jpeg-exif" : "file-date",
    };
  } catch {
    return fileDateSuggestion(file);
  }
}

function fileDateSuggestion(file: File): LocalPhotoSuggestion {
  const date = Number.isFinite(file.lastModified) && file.lastModified > 0
    ? new Date(file.lastModified)
    : null;
  return {
    capturedAt: date && Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : null,
    publicPoint: null,
    source: date ? "file-date" : "none",
  };
}

function locateExifTiff(buffer: ArrayBuffer): TiffView | null {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xda || marker === 0xd9) return null;
    if (offset + 2 > view.byteLength) return null;
    const size = view.getUint16(offset, false);
    if (size < 2 || offset + size > view.byteLength) return null;
    if (
      marker === 0xe1 &&
      size >= 10 &&
      ascii(bytes, offset + 2, 6) === "Exif\u0000\u0000"
    ) {
      const tiffOffset = offset + 8;
      const byteOrder = ascii(bytes, tiffOffset, 2);
      if (byteOrder !== "II" && byteOrder !== "MM") return null;
      return {
        view,
        bytes,
        tiffOffset,
        littleEndian: byteOrder === "II",
      };
    }
    offset += size;
  }
  return null;
}

type IfdValue = {
  numberValue: number | null;
  textValue: string | null;
  type: number;
  count: number;
  valueOffset: number;
};

function readIfd(tiff: TiffView, relativeOffset: number): Map<number, IfdValue> {
  const result = new Map<number, IfdValue>();
  const offset = tiff.tiffOffset + relativeOffset;
  if (offset < tiff.tiffOffset || offset + 2 > tiff.view.byteLength) return result;
  const count = tiff.view.getUint16(offset, tiff.littleEndian);
  if (count > 256 || offset + 2 + count * 12 > tiff.view.byteLength) return result;
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    const tag = tiff.view.getUint16(entry, tiff.littleEndian);
    const type = tiff.view.getUint16(entry + 2, tiff.littleEndian);
    const valueCount = readUint32(tiff, entry + 4);
    const byteCount = valueCount * (type === 5 ? 8 : type === 3 ? 2 : 1);
    const valueOffset = byteCount <= 4 ? entry + 8 : tiff.tiffOffset + readUint32(tiff, entry + 8);
    if (valueOffset < 0 || valueOffset + byteCount > tiff.view.byteLength) continue;
    const textValue = type === 2
      ? ascii(tiff.bytes, valueOffset, valueCount).replace(/\u0000+$/, "")
      : null;
    const numberValue = type === 3
      ? tiff.view.getUint16(valueOffset, tiff.littleEndian)
      : type === 4
        ? readUint32(tiff, valueOffset)
        : null;
    result.set(tag, {
      numberValue,
      textValue,
      type,
      count: valueCount,
      valueOffset,
    });
  }
  return result;
}

function readGpsPoint(
  tiff: TiffView,
  gps: Map<number, IfdValue>,
): { lat: number; lng: number } | null {
  const latRef = gps.get(1)?.textValue?.toUpperCase();
  const lngRef = gps.get(3)?.textValue?.toUpperCase();
  const lat = readRationalCoordinate(tiff, gps.get(2));
  const lng = readRationalCoordinate(tiff, gps.get(4));
  if (!latRef || !lngRef || lat === null || lng === null) return null;
  const signedLat = latRef === "S" ? -lat : lat;
  const signedLng = lngRef === "W" ? -lng : lng;
  if (Math.abs(signedLat) > 90 || Math.abs(signedLng) > 180) return null;
  return { lat: signedLat, lng: signedLng };
}

function readRationalCoordinate(
  tiff: TiffView,
  value: IfdValue | undefined,
): number | null {
  if (!value || value.type !== 5 || value.count < 3) return null;
  const parts: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const offset = value.valueOffset + index * 8;
    if (offset + 8 > tiff.view.byteLength) return null;
    const numerator = readUint32(tiff, offset);
    const denominator = readUint32(tiff, offset + 4);
    if (denominator === 0) return null;
    parts.push(numerator / denominator);
  }
  return parts[0] + parts[1] / 60 + parts[2] / 3600;
}

function readUint32(tiff: TiffView, offset: number): number {
  return tiff.view.getUint32(offset, tiff.littleEndian);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  const end = Math.min(offset + length, bytes.length);
  for (let index = offset; index < end; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function normalizeExifDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(parsed) ? normalized : null;
}

function createLocalId(ordinal: number): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `queued-${Date.now().toString(36)}-${ordinal.toString(36)}`;
}
