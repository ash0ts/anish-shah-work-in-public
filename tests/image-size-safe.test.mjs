import assert from "node:assert/strict";
import test from "node:test";

import { imageSize } from "../vendor/image-size-safe/index.mjs";

test("bounded image metadata reads the site's build formats", () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  png.set([73, 72, 68, 82], 12);
  new DataView(png.buffer).setUint32(16, 640, false);
  new DataView(png.buffer).setUint32(20, 360, false);
  assert.deepEqual(imageSize(png), { width: 640, height: 360, type: "png" });

  assert.deepEqual(
    imageSize(new TextEncoder().encode('<svg viewBox="0 0 240 96"></svg>')),
    { width: 240, height: 96, type: "svg" },
  );
});

test("unpatched upstream ICNS, HEIF, and JXL formats fail closed", () => {
  const payloads = [
    Uint8Array.from([0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 16, 0, 0, 0, 0]),
    Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    Uint8Array.from([0, 0, 0, 0, 0x4a, 0x58, 0x4c, 0x20, 0, 0, 0, 0]),
  ];
  for (const payload of payloads) {
    assert.throws(() => imageSize(payload), /Unsupported or malformed image/);
  }
});
