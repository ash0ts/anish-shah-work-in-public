import type { TravelImageKind } from "./media";

const MAX_DIMENSION = 12_000;
const MAX_PIXELS = 100_000_000;

export type TravelImageInspection = {
  kind: TravelImageKind;
  width: number;
  height: number;
};

function dimensions(
  kind: TravelImageKind,
  width: number,
  height: number,
): TravelImageInspection | null {
  return Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_PIXELS
    ? { kind, width, height }
    : null;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function inspectJpeg(bytes: Uint8Array): TravelImageInspection | null {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) return null;
  let offset = 2;
  let size: TravelImageInspection | null = null;
  let foundScan = false;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      if (foundScan) return size;
      return null;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!foundScan) return null;
      continue;
    }
    if (marker === 0xd9) return offset === bytes.length && foundScan ? size : null;
    if (marker === 0xd8 || marker === 0x01) continue;
    if (offset + 2 > bytes.length - 2) return null;
    const length = uint16(bytes, offset);
    if (length < 2 || offset + length > bytes.length - 2) return null;
    if (sofMarkers.has(marker)) {
      if (length < 8 || size) return null;
      size = dimensions("jpeg", uint16(bytes, offset + 5), uint16(bytes, offset + 3));
      if (!size) return null;
    }
    if (marker === 0xda) {
      foundScan = true;
      offset += length;
      let foundNextMarker = false;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) return null;
        const scanMarker = bytes[offset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset += 1;
          continue;
        }
        offset = markerStart;
        foundNextMarker = true;
        break;
      }
      if (!foundNextMarker) return null;
      continue;
    }
    offset += length;
  }
  return null;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): TravelImageInspection | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || signature.some((byte, index) => bytes[index] !== byte)) {
    return null;
  }
  let offset = 8;
  let size: TravelImageInspection | null = null;
  let foundData = false;
  let foundEnd = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null;
    const length = uint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const end = crcOffset + 4;
    if (length > bytes.length || end > bytes.length) return null;
    const type = ascii(bytes, typeOffset, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (uint32(bytes, crcOffset) !== crc32(bytes, typeOffset, crcOffset)) return null;
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) return null;
      const width = uint32(bytes, dataOffset);
      const height = uint32(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[colorType]?.includes(bitDepth) ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        ![0, 1].includes(bytes[dataOffset + 12])
      ) return null;
      size = dimensions("png", width, height);
      if (!size) return null;
    } else if (type === "IHDR") {
      return null;
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return null;
    if (type === "IDAT") foundData = true;
    if (type === "IEND") {
      if (length !== 0 || !foundData || end !== bytes.length) return null;
      foundEnd = true;
    }
    offset = end;
    chunkIndex += 1;
    if (foundEnd) break;
  }
  return foundEnd ? size : null;
}

function inspectWebp(bytes: Uint8Array): TravelImageInspection | null {
  if (
    bytes.length < 26 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    uint32le(bytes, 4) + 8 !== bytes.length
  ) return null;
  let offset = 12;
  let size: TravelImageInspection | null = null;
  let bitstreamCount = 0;
  let extended = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const type = ascii(bytes, offset, 4);
    const length = uint32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const paddedEnd = dataOffset + length + (length % 2);
    if (length > bytes.length || paddedEnd > bytes.length) return null;
    if (type === "ANIM" || type === "ANMF") return null;
    if (type === "VP8X") {
      if (extended || length !== 10 || bitstreamCount > 0) return null;
      extended = true;
      if ((bytes[dataOffset] & 0x02) !== 0) return null;
      const width =
        1 + bytes[dataOffset + 4] + (bytes[dataOffset + 5] << 8) + (bytes[dataOffset + 6] << 16);
      const height =
        1 + bytes[dataOffset + 7] + (bytes[dataOffset + 8] << 8) + (bytes[dataOffset + 9] << 16);
      size = dimensions("webp", width, height);
      if (!size) return null;
    } else if (type === "VP8 ") {
      if (
        length < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) return null;
      bitstreamCount += 1;
      if (!size) {
        size = dimensions(
          "webp",
          uint16le(bytes, dataOffset + 6) & 0x3fff,
          uint16le(bytes, dataOffset + 8) & 0x3fff,
        );
      }
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) return null;
      bitstreamCount += 1;
      if (!size) {
        const b1 = bytes[dataOffset + 1];
        const b2 = bytes[dataOffset + 2];
        const b3 = bytes[dataOffset + 3];
        const b4 = bytes[dataOffset + 4];
        size = dimensions(
          "webp",
          1 + b1 + ((b2 & 0x3f) << 8),
          1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
        );
      }
    }
    if (!size && (type === "VP8 " || type === "VP8L")) return null;
    offset = paddedEnd;
  }
  return offset === bytes.length && bitstreamCount === 1 ? size : null;
}

type Box = { type: string; dataStart: number; end: number };

function boxes(bytes: Uint8Array, start: number, end: number): Box[] | null {
  const result: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const size32 = uint32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
    let header = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) return null;
      const high = uint32(bytes, offset + 8);
      const low = uint32(bytes, offset + 12);
      const expanded = high * 0x100000000 + low;
      if (!Number.isSafeInteger(expanded)) return null;
      size = expanded;
      header = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return null;
    result.push({ type, dataStart: offset + header, end: offset + size });
    offset += size;
    if (size32 === 0 && offset !== end) return null;
  }
  return offset === end ? result : null;
}

function primaryIspe(
  bytes: Uint8Array,
  metaChildren: Box[],
  primaryId: number,
): TravelImageInspection | null {
  const properties = metaChildren.filter((box) => box.type === "iprp");
  if (properties.length !== 1) return null;
  const propertyChildren = boxes(
    bytes,
    properties[0].dataStart,
    properties[0].end,
  );
  if (!propertyChildren) return null;
  const containers = propertyChildren.filter((box) => box.type === "ipco");
  const associations = propertyChildren.filter((box) => box.type === "ipma");
  if (containers.length !== 1 || associations.length === 0) return null;
  const propertyBoxes = boxes(bytes, containers[0].dataStart, containers[0].end);
  if (!propertyBoxes) return null;

  const primaryProperties = new Set<number>();
  let primaryAssociationEntries = 0;
  for (const association of associations) {
    if (association.end - association.dataStart < 8) return null;
    const version = bytes[association.dataStart];
    const flags =
      (bytes[association.dataStart + 1] << 16) |
      (bytes[association.dataStart + 2] << 8) |
      bytes[association.dataStart + 3];
    if (!(version === 0 || version === 1)) return null;
    const wideAssociation = (flags & 1) === 1;
    const itemIdBytes = version < 1 ? 2 : 4;
    const entryCount = uint32(bytes, association.dataStart + 4);
    let offset = association.dataStart + 8;
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      if (offset + itemIdBytes + 1 > association.end) return null;
      const itemId = itemIdBytes === 2
        ? uint16(bytes, offset)
        : uint32(bytes, offset);
      offset += itemIdBytes;
      const associationCount = bytes[offset++];
      const entryBytes = wideAssociation ? 2 : 1;
      if (offset + associationCount * entryBytes > association.end) return null;
      if (itemId === primaryId) primaryAssociationEntries += 1;
      for (let index = 0; index < associationCount; index += 1) {
        const encoded = wideAssociation
          ? uint16(bytes, offset + index * 2)
          : bytes[offset + index];
        const propertyIndex = wideAssociation
          ? encoded & 0x7fff
          : encoded & 0x7f;
        if (propertyIndex === 0 || propertyIndex > propertyBoxes.length) {
          return null;
        }
        if (itemId === primaryId) primaryProperties.add(propertyIndex);
      }
      offset += associationCount * entryBytes;
    }
    if (offset !== association.end) return null;
  }
  if (primaryAssociationEntries !== 1) return null;

  const dimensionsForPrimary = [...primaryProperties]
    .map((index) => propertyBoxes[index - 1])
    .filter((box) => box?.type === "ispe")
    .map((box) => {
      if (box.end - box.dataStart !== 12) return null;
      return dimensions(
        "heic",
        uint32(bytes, box.dataStart + 4),
        uint32(bytes, box.dataStart + 8),
      );
    });
  return dimensionsForPrimary.length === 1
    ? dimensionsForPrimary[0]
    : null;
}

function inspectHeic(bytes: Uint8Array): TravelImageInspection | null {
  if (bytes.length < 48) return null;
  const top = boxes(bytes, 0, bytes.length);
  if (!top || top[0]?.type !== "ftyp") return null;
  const fileType = top[0];
  if (fileType.end - fileType.dataStart < 8 || (fileType.end - fileType.dataStart) % 4 !== 0) {
    return null;
  }
  const brands: string[] = [];
  brands.push(ascii(bytes, fileType.dataStart, 4));
  for (let offset = fileType.dataStart + 8; offset < fileType.end; offset += 4) {
    brands.push(ascii(bytes, offset, 4));
  }
  const stillBrands = new Set(["heic", "heix"]);
  const sequenceBrands = new Set(["hevc", "hevx", "heim", "heis"]);
  if (
    !brands.some((brand) => stillBrands.has(brand)) ||
    brands.some((brand) => sequenceBrands.has(brand))
  ) return null;
  const metadataBoxes = top.filter((box) => box.type === "meta");
  const meta = metadataBoxes[0];
  if (
    metadataBoxes.length !== 1 ||
    !meta ||
    meta.end - meta.dataStart < 4 ||
    !top.some((box) => box.type === "mdat")
  ) {
    return null;
  }
  const metaChildren = boxes(bytes, meta.dataStart + 4, meta.end);
  if (!metaChildren) return null;
  const primaryItems = metaChildren.filter((box) => box.type === "pitm");
  const itemInfos = metaChildren.filter((box) => box.type === "iinf");
  if (primaryItems.length !== 1 || itemInfos.length !== 1) return null;
  const primary = primaryItems[0];
  if (primary.end - primary.dataStart < 6) return null;
  const primaryVersion = bytes[primary.dataStart];
  const primaryId = primaryVersion === 0
    ? uint16(bytes, primary.dataStart + 4)
    : primaryVersion === 1 && primary.end - primary.dataStart >= 8
      ? uint32(bytes, primary.dataStart + 4)
      : null;
  if (primaryId === null) return null;
  const info = itemInfos[0];
  if (info.end - info.dataStart < 6) return null;
  const infoVersion = bytes[info.dataStart];
  const countBytes = infoVersion === 0 ? 2 : 4;
  const entriesStart = info.dataStart + 4 + countBytes;
  if (entriesStart > info.end) return null;
  const entries = boxes(bytes, entriesStart, info.end);
  const declaredEntries = infoVersion === 0
    ? uint16(bytes, info.dataStart + 4)
    : uint32(bytes, info.dataStart + 4);
  if (!entries || entries.length !== declaredEntries) return null;
  let matchingPrimary = 0;
  for (const entry of entries) {
    if (entry.type !== "infe" || entry.end - entry.dataStart < 12) continue;
    const version = bytes[entry.dataStart];
    if (!(version === 2 || version === 3)) continue;
    const itemId = version === 2
      ? uint16(bytes, entry.dataStart + 4)
      : uint32(bytes, entry.dataStart + 4);
    const itemTypeOffset = entry.dataStart + (version === 2 ? 8 : 10);
    const itemType = ascii(bytes, itemTypeOffset, 4);
    if (itemId === primaryId && (itemType === "hvc1" || itemType === "grid")) {
      matchingPrimary += 1;
    }
  }
  if (matchingPrimary !== 1) return null;
  return primaryIspe(bytes, metaChildren, primaryId);
}

export function inspectTravelImage(
  bytes: Uint8Array,
  expected: TravelImageKind,
): TravelImageInspection | null {
  const result =
    expected === "jpeg"
      ? inspectJpeg(bytes)
      : expected === "png"
        ? inspectPng(bytes)
        : expected === "webp"
          ? inspectWebp(bytes)
          : inspectHeic(bytes);
  return result?.kind === expected ? result : null;
}
