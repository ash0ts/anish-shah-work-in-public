const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_SVG_HEADER_BYTES = 64 * 1024;
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function invalid(message = "Unsupported or malformed image.") {
  throw new TypeError(message);
}

function checkedInput(input) {
  if (!(input instanceof Uint8Array)) invalid("Image input must be a Uint8Array.");
  if (input.length < 4 || input.length > MAX_INPUT_BYTES) {
    invalid("Image input is empty or exceeds the build-time limit.");
  }
  return input;
}

function bytesEqual(input, offset, expected) {
  if (offset < 0 || offset + expected.length > input.length) return false;
  return expected.every((value, index) => input[offset + index] === value);
}

function ascii(input, start, end) {
  return new TextDecoder("ascii", { fatal: true }).decode(input.slice(start, end));
}

function uint16be(input, offset) {
  if (offset + 2 > input.length) invalid();
  return input[offset] * 256 + input[offset + 1];
}

function uint16le(input, offset) {
  if (offset + 2 > input.length) invalid();
  return input[offset] + input[offset + 1] * 256;
}

function uint24le(input, offset) {
  if (offset + 3 > input.length) invalid();
  return input[offset] + input[offset + 1] * 256 + input[offset + 2] * 65_536;
}

function uint32be(input, offset) {
  if (offset + 4 > input.length) invalid();
  return new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, false);
}

function int32le(input, offset) {
  if (offset + 4 > input.length) invalid();
  return new DataView(input.buffer, input.byteOffset + offset, 4).getInt32(0, true);
}

function positiveDimensions(width, height, type) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 1_000_000 ||
    height > 1_000_000
  ) {
    invalid("Image dimensions are invalid.");
  }
  return { width, height, type };
}

function png(input) {
  if (!bytesEqual(input, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return null;
  if (input.length < 24 || ascii(input, 12, 16) !== "IHDR") invalid();
  return positiveDimensions(uint32be(input, 16), uint32be(input, 20), "png");
}

function gif(input) {
  const header = input.length >= 10 ? ascii(input, 0, 6) : "";
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  return positiveDimensions(uint16le(input, 6), uint16le(input, 8), "gif");
}

function bmp(input) {
  if (!bytesEqual(input, 0, [0x42, 0x4d])) return null;
  if (input.length < 26) invalid();
  return positiveDimensions(int32le(input, 18), Math.abs(int32le(input, 22)), "bmp");
}

function ico(input) {
  if (!bytesEqual(input, 0, [0, 0, 1, 0])) return null;
  if (input.length < 22 || uint16le(input, 4) < 1) invalid();
  return positiveDimensions(input[6] || 256, input[7] || 256, "ico");
}

function jpeg(input) {
  if (!bytesEqual(input, 0, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 1 < input.length) {
    while (offset < input.length && input[offset] === 0xff) offset += 1;
    if (offset >= input.length) break;
    const marker = input[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = uint16be(input, offset);
    if (length < 2 || offset + length > input.length) invalid();
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 7) invalid();
      return positiveDimensions(
        uint16be(input, offset + 5),
        uint16be(input, offset + 3),
        "jpg",
      );
    }
    offset += length;
  }
  invalid("JPEG does not contain a supported frame header.");
}

function webp(input) {
  if (
    input.length < 30 ||
    ascii(input, 0, 4) !== "RIFF" ||
    ascii(input, 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const kind = ascii(input, 12, 16);
  if (kind === "VP8X") {
    return positiveDimensions(
      uint24le(input, 24) + 1,
      uint24le(input, 27) + 1,
      "webp",
    );
  }
  if (kind === "VP8L") {
    if (input[20] !== 0x2f) invalid();
    const bits =
      input[21] +
      input[22] * 256 +
      input[23] * 65_536 +
      input[24] * 16_777_216;
    return positiveDimensions(
      (bits & 0x3fff) + 1,
      ((bits >>> 14) & 0x3fff) + 1,
      "webp",
    );
  }
  if (kind === "VP8 ") {
    if (!bytesEqual(input, 23, [0x9d, 0x01, 0x2a])) invalid();
    return positiveDimensions(
      uint16le(input, 26) & 0x3fff,
      uint16le(input, 28) & 0x3fff,
      "webp",
    );
  }
  invalid("Unsupported WebP encoding.");
}

function numericSvgDimension(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value ?? "");
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function svg(input) {
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(
    input.slice(0, Math.min(input.length, MAX_SVG_HEADER_BYTES)),
  );
  const opening = /<svg\b([^>]*)>/i.exec(prefix);
  if (!opening) return null;
  const attributes = opening[1];
  const width = numericSvgDimension(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]);
  const height = numericSvgDimension(/\bheight\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]);
  if (width && height) return positiveDimensions(width, height, "svg");
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
  const values = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) invalid();
  return positiveDimensions(Math.round(values[2]), Math.round(values[3]), "svg");
}

export function imageSize(value) {
  const input = checkedInput(value);
  for (const parser of [png, gif, jpeg, webp, bmp, ico, svg]) {
    const dimensions = parser(input);
    if (dimensions) return dimensions;
  }
  // ICNS, HEIF/AVIF, and JXL are deliberately unsupported. Their upstream
  // parsers have unpatched infinite-loop advisories; failing the build is safer.
  invalid();
}
