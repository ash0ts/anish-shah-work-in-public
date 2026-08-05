import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const {
  deleteTravelMedia,
  detectTravelImageKind,
  servePublishedTravelMedia,
  storeTravelUpload,
  travelVariantStorageKeys,
} = await import(
  "../lib/server/travel/media.ts"
);
const { inspectTravelImage } = await import(
  "../lib/server/travel/image-policy.ts"
);
const { getTravelHealth } = await import(
  "../lib/server/travel/maintenance.ts"
);
const {
  findPublishedTravelMedia,
  getTravelUploadForWrite,
  patchTravelPhoto,
  patchTravelPlace,
  readTravelKvSnapshot,
  TRAVEL_FALLBACK_GATE_KEY,
  TRAVEL_POINTER_KEY,
  travelPublicationVersionKey,
} = await import("../lib/server/travel/repository.ts");
const { previewTravelAtlas } = await import(
  "../lib/server/travel/preview.ts"
);

function concat(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function u32(value, littleEndian = false) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, littleEndian);
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload = new Uint8Array()) {
  const name = new TextEncoder().encode(type);
  const checked = concat(name, payload);
  return concat(u32(payload.length), checked, u32(crc32(checked)));
}

function png(width = 2, height = 2, extra = []) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  return concat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...extra,
    pngChunk("IDAT"),
    pngChunk("IEND"),
  );
}

function webpChunk(type, payload) {
  return concat(
    new TextEncoder().encode(type),
    u32(payload.length, true),
    payload,
    payload.length % 2 ? Uint8Array.of(0) : new Uint8Array(),
  );
}

function webp(chunks = [webpChunk("VP8L", Uint8Array.of(0x2f, 1, 0x40, 0, 0))]) {
  const body = concat(new TextEncoder().encode("WEBP"), ...chunks);
  return concat(new TextEncoder().encode("RIFF"), u32(body.length, true), body);
}

function jpeg() {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ]);
}

function isoBox(type, payload = new Uint8Array()) {
  return concat(u32(payload.length + 8), new TextEncoder().encode(type), payload);
}

function heic(brand = "heic", associationIndex = 1, compatibleBrand = brand) {
  const ispe = isoBox("ispe", concat(new Uint8Array(4), u32(2), u32(2)));
  const ipco = isoBox("ipco", ispe);
  const ipma = isoBox(
    "ipma",
    concat(
      Uint8Array.of(0, 0, 0, 0),
      u32(1),
      Uint8Array.of(0, 1),
      Uint8Array.of(associationIndex),
      Uint8Array.of(1),
    ),
  );
  const iprp = isoBox("iprp", concat(ipco, ipma));
  const pitm = isoBox(
    "pitm",
    concat(Uint8Array.of(0, 0, 0, 0), Uint8Array.of(0, 1)),
  );
  const infe = isoBox(
    "infe",
    concat(
      Uint8Array.of(2, 0, 0, 0),
      Uint8Array.of(0, 1),
      Uint8Array.of(0, 0),
      new TextEncoder().encode("hvc1"),
      Uint8Array.of(0),
    ),
  );
  const iinf = isoBox(
    "iinf",
    concat(Uint8Array.of(0, 0, 0, 0), Uint8Array.of(0, 1), infe),
  );
  const meta = isoBox(
    "meta",
    concat(new Uint8Array(4), pitm, iinf, iprp),
  );
  const ftyp = isoBox(
    "ftyp",
    concat(
      new TextEncoder().encode(compatibleBrand),
      new Uint8Array(4),
      new TextEncoder().encode(brand),
    ),
  );
  return concat(ftyp, meta, isoBox("mdat"));
}

async function streamBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  const response = new Response(value);
  return new Uint8Array(await response.arrayBuffer());
}

function uploadRequest(body, {
  contentType = "image/png",
  contentLength,
} = {}) {
  const headers = new Headers({ "content-type": contentType });
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }
  return new Request(
    "https://anish-shah-is.online/api/studio/travel/uploads/upload_runtime_12345678",
    {
      method: "PUT",
      headers,
      body,
      duplex: "half",
    },
  );
}

function uploadRuntimeHarness({
  declaredBytes,
  mediaType = "image/png",
  transformedBytes = webp(),
  transformResponseStatus = 200,
  transformResponseType = "image/webp",
  deleteFailure = false,
} = {}) {
  const objects = new Map();
  const events = [];
  const persistence = {
    async getForWrite(input) {
      events.push(["get", input]);
      return {
        id: "upload_runtime_12345678",
        tripId: "trip_runtime_12345678",
        tripRevision: "a".repeat(32),
        tokenHash: "test-only",
        status: "issued",
        mediaType,
        declaredBytes,
        storedBytes: null,
        processedWidth: null,
        processedHeight: null,
        storageKey: null,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
    async markTemporary(input) {
      events.push(["mark", input]);
    },
    async completeStorage(input) {
      events.push(["complete", input]);
    },
    async fail(uploadId) {
      events.push(["fail", uploadId]);
    },
  };
  const bucket = {
    async put(key, value, options) {
      events.push(["put", key, options, value instanceof ReadableStream]);
      const bytes = await streamBytes(value);
      objects.set(key, bytes);
      return { key, size: bytes.byteLength, httpEtag: "test" };
    },
    async get(key) {
      events.push(["get-object", key]);
      const bytes = objects.get(key);
      return bytes
        ? { body: new Response(bytes).body, size: bytes.byteLength }
        : null;
    },
    async delete(keyOrKeys) {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      events.push(["delete", ...keys]);
      if (deleteFailure) throw new Error("simulated_r2_delete_failure");
      for (const key of keys) objects.delete(key);
    },
  };
  let inputBytes = null;
  let transformOptions = null;
  let outputOptions = null;
  const images = {
    input(value) {
      events.push(["images-input"]);
      return {
        transform(options) {
          transformOptions = options;
          events.push(["images-transform", options]);
          return {
            async output(options) {
              outputOptions = options;
              inputBytes = await streamBytes(value);
              events.push(["images-output", options]);
              return {
                response() {
                  return new Response(transformedBytes, {
                    status: transformResponseStatus,
                    headers: { "content-type": transformResponseType },
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    bucket,
    events,
    images,
    objects,
    persistence,
    inspection() {
      return { inputBytes, transformOptions, outputOptions };
    },
  };
}

async function executeUpload(request, harness) {
  return storeTravelUpload({
    request,
    uploadId: "upload_runtime_12345678",
    uploadToken: "t".repeat(48),
    expectedTripRevision: "a".repeat(32),
    actorEmail: "owner@example.com",
    bucket: harness.bucket,
    images: harness.images,
    persistence: harness.persistence,
  });
}

test("travel image signatures accept closed raster formats and reject SVG/polyglot prefixes", () => {
  assert.equal(
    detectTravelImageKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    "jpeg",
  );
  assert.equal(
    detectTravelImageKind(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "png",
  );
  assert.equal(
    detectTravelImageKind(
      new TextEncoder().encode("RIFF0000WEBPpayload"),
    ),
    "webp",
  );
  assert.equal(
    detectTravelImageKind(
      Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    ),
    "heic",
  );
  assert.equal(
    detectTravelImageKind(new TextEncoder().encode("<svg><script/></svg>")),
    null,
  );
});

test("travel image inspection rejects animation, polyglots, malformed containers, and pixel bombs", () => {
  assert.deepEqual(inspectTravelImage(jpeg(), "jpeg"), {
    kind: "jpeg",
    width: 2,
    height: 2,
  });
  assert.equal(inspectTravelImage(concat(jpeg(), Uint8Array.of(1)), "jpeg"), null);
  assert.equal(
    inspectTravelImage(
      concat(
        jpeg().slice(0, -2),
        Uint8Array.of(0xff, 0xd9),
        new TextEncoder().encode("<script>polyglot</script>"),
        Uint8Array.of(0xff, 0xd9),
      ),
      "jpeg",
    ),
    null,
  );

  assert.deepEqual(inspectTravelImage(png(), "png"), {
    kind: "png",
    width: 2,
    height: 2,
  });
  assert.equal(
    inspectTravelImage(png(2, 2, [pngChunk("acTL", concat(u32(1), u32(0)))]), "png"),
    null,
  );
  assert.equal(inspectTravelImage(concat(png(), Uint8Array.of(0)), "png"), null);
  assert.equal(inspectTravelImage(png(12_000, 12_000), "png"), null);

  assert.deepEqual(inspectTravelImage(webp(), "webp"), {
    kind: "webp",
    width: 2,
    height: 2,
  });
  assert.equal(
    inspectTravelImage(webp([webpChunk("ANIM", new Uint8Array(6))]), "webp"),
    null,
  );
  const wrongRiff = webp();
  wrongRiff[4] += 1;
  assert.equal(inspectTravelImage(wrongRiff, "webp"), null);

  assert.deepEqual(inspectTravelImage(heic(), "heic"), {
    kind: "heic",
    width: 2,
    height: 2,
  });
  assert.equal(inspectTravelImage(heic("mif1"), "heic"), null);
  assert.equal(inspectTravelImage(heic("hevc"), "heic"), null);
  assert.equal(inspectTravelImage(heic("heic", 1, "heis"), "heic"), null);
  assert.equal(inspectTravelImage(heic("heic", 2), "heic"), null);
  assert.equal(inspectTravelImage(heic().slice(0, -1), "heic"), null);
});

test("travel upload streams into temporary R2 and stores only a metadata-stripped WebP master", async () => {
  const source = png();
  const sanitized = webp();
  const harness = uploadRuntimeHarness({
    declaredBytes: source.byteLength,
    transformedBytes: sanitized,
  });
  const response = await executeUpload(
    uploadRequest(source, { contentLength: source.byteLength }),
    harness,
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: "uploaded",
    uploadId: "upload_runtime_12345678",
  });
  const mark = harness.events.find(([event]) => event === "mark");
  const complete = harness.events.find(([event]) => event === "complete");
  assert.ok(mark);
  assert.ok(complete);
  const rawKey = mark[1].rawKey;
  const masterKey = complete[1].storageKey;
  assert.match(rawKey, /^temporary\/travel\/upload_runtime_12345678\//);
  assert.equal(
    masterKey,
    "private/travel/masters/upload_runtime_12345678/source.webp",
  );
  const rawPut = harness.events.find(
    ([event, key]) => event === "put" && key === rawKey,
  );
  const masterPut = harness.events.find(
    ([event, key]) => event === "put" && key === masterKey,
  );
  assert.equal(rawPut[3], true, "the request body must reach R2 as a stream");
  assert.deepEqual(rawPut[2], {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { lifecycle: "temporary" },
  });
  assert.deepEqual(masterPut[2], {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: { metadata: "stripped", lifecycle: "master" },
  });
  assert.deepEqual(harness.objects.get(masterKey), sanitized);
  assert.equal(harness.objects.has(rawKey), false);
  assert.deepEqual(harness.inspection(), {
    inputBytes: source,
    transformOptions: {
      width: 4096,
      height: 4096,
      fit: "scale-down",
      rotate: "auto",
      metadata: "none",
    },
    outputOptions: { format: "image/webp", quality: 88 },
  });
  assert.deepEqual(complete[1], {
    uploadId: "upload_runtime_12345678",
    storageKey: masterKey,
    storedBytes: sanitized.byteLength,
    processedWidth: 2,
    processedHeight: 2,
    actorEmail: "owner@example.com",
    tripId: "trip_runtime_12345678",
    expectedTripRevision: "a".repeat(32),
  });
  assert.equal(
    harness.events.findIndex(
      ([event, ...keys]) => event === "delete" && keys.includes(rawKey),
    ) < harness.events.findIndex(([event]) => event === "complete"),
    true,
    "temporary bytes must be deleted before D1 marks the upload complete",
  );
  assert.equal(harness.events.some(([event]) => event === "fail"), false);
});

test("travel upload rejects declared oversize, size mismatch, and media-type mismatch before R2", async (t) => {
  const source = png();
  const maximum = 20 * 1024 * 1024;
  const cases = [
    {
      name: "declared oversize",
      harness: uploadRuntimeHarness({ declaredBytes: maximum }),
      request: uploadRequest(source, { contentLength: maximum + 1 }),
      status: 413,
      code: "request_too_large",
    },
    {
      name: "transaction size mismatch",
      harness: uploadRuntimeHarness({ declaredBytes: source.byteLength }),
      request: uploadRequest(source, { contentLength: source.byteLength - 1 }),
      status: 400,
      code: "invalid_image_size",
    },
    {
      name: "declared MIME mismatch",
      harness: uploadRuntimeHarness({
        declaredBytes: source.byteLength,
        mediaType: "image/png",
      }),
      request: uploadRequest(source, {
        contentType: "image/jpeg",
        contentLength: source.byteLength,
      }),
      status: 415,
      code: "invalid_image_type",
    },
  ];

  for (const sample of cases) {
    await t.test(sample.name, async () => {
      const response = await executeUpload(sample.request, sample.harness);
      assert.equal(response.status, sample.status);
      assert.equal((await response.json()).code, sample.code);
      assert.equal(
        sample.harness.events.some(([event]) =>
          event === "mark" || event === "put" || event === "fail"),
        false,
      );
    });
  }
});

test("travel upload bounds a chunked body while it is streaming", async () => {
  const maximum = 20 * 1024 * 1024;
  const chunk = new Uint8Array(1024 * 1024);
  let emitted = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (emitted <= 20) {
        emitted += 1;
        controller.enqueue(chunk);
        return;
      }
      controller.close();
    },
  });
  const harness = uploadRuntimeHarness({ declaredBytes: maximum });
  const response = await executeUpload(uploadRequest(body), harness);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "request_too_large");
  assert.equal(emitted, 21);
  assert.equal(
    harness.events.some(([event, , , streamed]) => event === "put" && streamed),
    true,
  );
  assert.equal(harness.events.some(([event]) => event === "fail"), true);
  assert.equal(harness.objects.size, 0);
  assert.equal(
    harness.events.some(([event, ...keys]) =>
      event === "delete" && keys.some((key) =>
        String(key).startsWith("temporary/travel/"))),
    true,
  );
});

test("travel upload treats interrupted streams and signature mismatches as failed transactions", async (t) => {
  await t.test("interrupted request stream", async () => {
    const source = png();
    let pull = 0;
    const body = new ReadableStream({
      pull(controller) {
        pull += 1;
        if (pull === 1) {
          controller.enqueue(source.slice(0, 8));
          return;
        }
        controller.error(new Error("simulated_client_disconnect"));
      },
    });
    const harness = uploadRuntimeHarness({ declaredBytes: source.byteLength });
    const response = await executeUpload(uploadRequest(body), harness);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "image_processing_failed");
    assert.equal(harness.events.some(([event]) => event === "fail"), true);
    assert.equal(harness.objects.size, 0);
  });

  await t.test("body signature does not match the declared MIME", async () => {
    const wrongBytes = jpeg();
    const harness = uploadRuntimeHarness({
      declaredBytes: wrongBytes.byteLength,
      mediaType: "image/png",
    });
    const response = await executeUpload(
      uploadRequest(wrongBytes, { contentLength: wrongBytes.byteLength }),
      harness,
    );
    assert.equal(response.status, 415);
    assert.equal((await response.json()).code, "invalid_image_signature");
    assert.equal(harness.events.some(([event]) => event === "fail"), true);
    assert.equal(harness.events.some(([event]) => event === "images-input"), false);
    assert.equal(harness.objects.size, 0);
  });
});

test("travel upload transformation failures clean private keys and preserve an observable failed state", async (t) => {
  const source = png();
  for (const deleteFailure of [false, true]) {
    await t.test(
      deleteFailure ? "R2 cleanup rejection" : "successful R2 cleanup",
      async () => {
        const harness = uploadRuntimeHarness({
          declaredBytes: source.byteLength,
          transformResponseStatus: 502,
          transformResponseType: "text/plain",
          deleteFailure,
        });
        const response = await executeUpload(
          uploadRequest(source, { contentLength: source.byteLength }),
          harness,
        );
        assert.equal(response.status, 422);
        assert.equal((await response.json()).code, "image_processing_failed");
        assert.equal(harness.events.some(([event]) => event === "fail"), true);
        const attemptedDeletes = harness.events
          .filter(([event]) => event === "delete")
          .flatMap(([, ...keys]) => keys);
        assert.equal(
          attemptedDeletes.includes(
            "private/travel/masters/upload_runtime_12345678/source.webp",
          ),
          true,
        );
        assert.equal(
          attemptedDeletes.some((key) =>
            String(key).startsWith("temporary/travel/")),
          true,
        );
        if (!deleteFailure) assert.equal(harness.objects.size, 0);
      },
    );
  }
});

test("unpublication blocks stale private derivatives before R2 is consulted", async () => {
  const storageKey = "private/travel/masters/upload_12345678/source.webp";
  const digest = "a".repeat(64);
  const variantKey = `private/travel/variants/photo_12345678/${digest}/480.webp`;
  let reads = 0;
  const bucket = {
    async get(key) {
      reads += 1;
      assert.equal(key, variantKey);
      return { body: new Response(webp()).body, size: webp().length };
    },
    async put() {
      throw new Error("cache should already exist");
    },
    async delete() {},
  };
  const ready = await servePublishedTravelMedia({
    photoId: "photo_12345678",
    digest,
    variant: "480",
    bucket,
    images: {},
    publicationLookup: async () => ({ storageKey }),
  });
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("cache-control"), "private, no-store");
  assert.equal(reads, 1);

  const unpublished = await servePublishedTravelMedia({
    photoId: "photo_12345678",
    digest,
    variant: "480",
    bucket,
    images: {},
    publicationLookup: async () => null,
  });
  assert.equal(unpublished.status, 404);
  assert.equal(reads, 1);
});

test("KV fallback remains closed unless pointer activation and gate agree", async () => {
  const snapshot = await previewTravelAtlas();
  const versionKey = travelPublicationVersionKey(
    snapshot.contentHash,
    snapshot.publishedAt,
  );
  const records = new Map([
    [
      versionKey,
      JSON.stringify({
        schemaVersion: "1.0",
        snapshotJson: JSON.stringify(snapshot),
        contentHash: snapshot.contentHash,
        replicatedAt: snapshot.publishedAt,
      }),
    ],
    [
      TRAVEL_POINTER_KEY,
      JSON.stringify({
        schemaVersion: "1.0",
        versionKey,
        contentHash: snapshot.contentHash,
        activatedAt: snapshot.publishedAt,
      }),
    ],
    [
      TRAVEL_FALLBACK_GATE_KEY,
      JSON.stringify({
        schemaVersion: "1.0",
        state: "closed",
        contentHash: snapshot.contentHash,
        updatedAt: snapshot.publishedAt,
      }),
    ],
  ]);
  const kv = {
    async get(key) { return records.get(key) ?? null; },
  };
  assert.equal(await readTravelKvSnapshot(kv), null);
  records.set(
    TRAVEL_FALLBACK_GATE_KEY,
    JSON.stringify({
      schemaVersion: "1.0",
      state: "open",
      contentHash: snapshot.contentHash,
      updatedAt: snapshot.publishedAt,
    }),
  );
  assert.deepEqual(await readTravelKvSnapshot(kv), snapshot);
  records.set(
    TRAVEL_FALLBACK_GATE_KEY,
    JSON.stringify({
      schemaVersion: "1.0",
      state: "open",
      contentHash: "c".repeat(64),
      updatedAt: snapshot.publishedAt,
    }),
  );
  assert.equal(await readTravelKvSnapshot(kv), null);
});

test("preview media is a closed synthetic first-party response without durable access", async () => {
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "26",
    SITE_URL: "https://pr-26.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
    RELEASE_VERSION: "2.0.0-rc.1",
    TRAVEL_ATLAS_MODE: "atlas-v1",
  };
  try {
    const snapshot = await previewTravelAtlas();
    const photo = snapshot.trips.flatMap((trip) => trip.photos)[0];
    const result = await servePublishedTravelMedia({
      photoId: photo.id,
      digest: photo.mediaDigest,
      variant: "480",
      publicationLookup: async () => {
        throw new Error("preview must not read D1");
      },
      bucket: new Proxy({}, { get() { throw new Error("preview must not read R2"); } }),
      images: new Proxy({}, { get() { throw new Error("preview must not use Images"); } }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-preview-artwork"), "synthetic-travel-placeholder");
    assert.match(result.headers.get("content-type"), /^image\/svg\+xml/);
  } finally {
    delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  }
});

test("photo deletion removes the master and all deterministic private derivatives", async () => {
  const deleted = [];
  const bucket = {
    async get() { return null; },
    async put() {},
    async delete(keys) { deleted.push(...(Array.isArray(keys) ? keys : [keys])); },
  };
  const photoId = "photo_12345678";
  const storageKey = "private/travel/masters/upload_12345678/source.webp";
  const variantKeys = await travelVariantStorageKeys(photoId, storageKey);
  await deleteTravelMedia(photoId, storageKey, bucket);
  assert.deepEqual(deleted, [storageKey, ...variantKeys]);
  assert.equal(variantKeys.length, 3);
});

test("travel migration is additive and contains the complete private publication boundary", async () => {
  const migrationNames = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.equal(migrationNames.at(-1), "0007_travel_atlas.sql");
  const migration = await readFile(
    new URL("../drizzle/0007_travel_atlas.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "travel_trips",
    "travel_places",
    "travel_photos",
    "travel_photo_tags",
    "travel_uploads",
    "travel_media_deletions",
    "travel_publication_snapshots",
    "travel_publication_state",
  ]) {
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /FOREIGN KEY \(`trip_id`\)/);
  assert.match(migration, /ON DELETE cascade/);
  assert.match(migration, /travel\.cleanup/);
  assert.match(migration, /processed_width/);
  assert.match(migration, /processed_height/);
  assert.doesNotMatch(migration, /filename|exif|gps|camera|device/i);
});

test("all travel owner mutations preserve the shared security order and bounded parsing", async () => {
  const http = await readFile(
    new URL("../lib/server/travel/http.ts", import.meta.url),
    "utf8",
  );
  const ownerHelper = http.indexOf("async function ownerMutation");
  assert.equal(ownerHelper >= 0, true);
  const helper = http.slice(ownerHelper, http.indexOf("async function pathParam"));
  assert.equal(
    helper.indexOf("rejectCrossOriginWrite") < helper.indexOf("authorizeOwnerApi"),
    true,
  );
  assert.match(http, /readBoundedJsonBody\(request, \{ maxBytes:/);
  assert.match(http, /strongRevision\(request\)/);
  const createPlace = http.slice(
    http.indexOf("export async function studioTravelPlacePost"),
    http.indexOf("export async function studioTravelPlacePatch"),
  );
  assert.equal(
    createPlace.indexOf("strongRevision(request)") <
      createPlace.indexOf("createTravelPlace"),
    true,
  );
  assert.match(http, /x-travel-upload-token/);
  assert.match(http, /studioTravelPhotoPreviewGet/);

  const tripPreview = http.slice(
    http.indexOf("export async function studioTravelTripPreviewGet"),
    http.indexOf("export async function studioTravelTripPatch"),
  );
  assert.equal(
    tripPreview.indexOf("authorizeOwnerApi") <
      tripPreview.indexOf("getTravelTripDraftPreview"),
    true,
  );
  assert.match(tripPreview, /PRIVATE_HEADERS/);

  const previewRoute = await readFile(
    new URL(
      "../app/api/studio/travel/trips/[id]/preview/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(previewRoute, /studioTravelTripPreviewGet/);
  assert.doesNotMatch(previewRoute, /POST|PATCH|PUT|DELETE/);
});

test("media lookup verifies the active D1 publication before reading private storage", async () => {
  const snapshot = await previewTravelAtlas();
  const photo = snapshot.trips.flatMap((trip) => trip.photos)[0];
  assert.ok(photo);
  const queries = [];
  const binding = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("travel_publication_state")) {
            return {
              snapshotJson: JSON.stringify(snapshot),
              contentHash: snapshot.contentHash,
            };
          }
          if (sql.includes("SELECT storage_key")) {
            return {
              storageKey: "private/travel/masters/upload_12345678/source.webp",
            };
          }
          throw new Error(`Unexpected Travel media query: ${sql}`);
        },
      };
    },
  };
  assert.deepEqual(
    await findPublishedTravelMedia(photo.id, photo.mediaDigest, binding),
    { storageKey: "private/travel/masters/upload_12345678/source.webp" },
  );
  assert.equal(queries.length, 2);
  assert.match(queries[0], /travel_publication_state/);
  assert.match(queries[1], /SELECT storage_key/);

  let privateStorageRead = false;
  const invalidBinding = {
    prepare(sql) {
      return {
        bind() {
          privateStorageRead = true;
          return this;
        },
        async first() {
          return sql.includes("travel_publication_state")
            ? {
                snapshotJson: JSON.stringify(snapshot),
                contentHash: "0".repeat(64),
              }
            : null;
        },
      };
    },
  };
  assert.equal(
    await findPublishedTravelMedia(photo.id, photo.mediaDigest, invalidBinding),
    null,
  );
  assert.equal(privateStorageRead, false);

  const media = await readFile(
    new URL("../lib/server/travel/media.ts", import.meta.url),
    "utf8",
  );
  assert.match(media, /metadata: "none"/);
  assert.match(media, /private\/travel\/masters\//);
  assert.match(media, /private\/travel\/variants\//);
  assert.match(media, /cache-control": "private, no-store"/);
  assert.doesNotMatch(media, /max-age=31536000|immutable/);
  assert.match(media, /x-robots-tag": "noimageindex"/);
  assert.doesNotMatch(media, /fetch\(\s*["'`]https?:\/\//);
});

test("interrupted uploads remain traceable and retention removes inactive KV versions", async () => {
  const media = await readFile(
    new URL("../lib/server/travel/media.ts", import.meta.url),
    "utf8",
  );
  assert.equal(media.indexOf("markTravelUploadTemporaryStorage") >= 0, true);
  assert.match(media, /await bucket\.put\(\s*rawKey,/);
  assert.equal(
    media.indexOf("markTravelUploadTemporaryStorage") <
      media.search(/await bucket\.put\(\s*rawKey,/),
    true,
  );
  assert.match(
    media,
    /private\/travel\/masters\/\$\{input\.uploadId\}\/source\.webp/,
  );

  const maintenance = await readFile(
    new URL("../lib/server/travel/maintenance.ts", import.meta.url),
    "utf8",
  );
  assert.match(maintenance, /temporary\/travel\//);
  assert.match(maintenance, /private\/travel\/masters\/\$\{row\.id\}\/source\.webp/);
  assert.match(maintenance, /LEFT JOIN travel_publication_state/);
  assert.match(maintenance, /state\.snapshot_id IS NULL/);
  assert.match(maintenance, /publicationKv\.delete/);
  assert.match(maintenance, /travel_media_deletions/);
  assert.equal(
    maintenance.indexOf("await bucket.delete(keys)") <
      maintenance.indexOf("DELETE FROM travel_uploads"),
    true,
  );
  assert.equal(
    travelPublicationVersionKey(
      "b".repeat(64),
      "2026-01-02T03:04:05.000Z",
    ),
    `travel:version:v1:${"b".repeat(64)}:1767323045000`,
  );
});

test("travel health requires both D1 and private media configuration", async () => {
  const bomb = new Proxy({}, {
    get() {
      throw new Error("D1 should not be read when media is missing");
    },
  });
  const health = await getTravelHealth(bomb, Date.now(), {
    mediaConfigured: false,
    imagesConfigured: true,
  });
  assert.equal(health.configured, false);
  assert.equal(health.activePublication, null);
  const noImages = await getTravelHealth(bomb, Date.now(), {
    mediaConfigured: true,
    imagesConfigured: false,
  });
  assert.equal(noImages.configured, false);
});

test("sanitized master dimensions are server-owned and immutable", async () => {
  const media = await readFile(
    new URL("../lib/server/travel/media.ts", import.meta.url),
    "utf8",
  );
  assert.match(media, /sanitizedInspection\.width/);
  assert.match(media, /sanitizedInspection\.height/);
  let batchCalled = false;
  const binding = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          assert.match(sql, /FROM travel_photos AS photos/);
          return {
            id: "photo_12345678",
            tripId: "trip_12345678",
            placeId: "place_12345678",
            altText: "A metadata-free photo.",
            caption: null,
            capturedAt: "2025-10",
            capturePrecision: "month",
            width: 1600,
            height: 1067,
            sortOrder: 0,
            isCover: 1,
            storageKey: "private/travel/masters/upload_12345678/source.webp",
            revision: "photo-revision-12345678",
            tripRevision: "trip-revision-12345678",
          };
        },
      };
    },
    async batch() {
      batchCalled = true;
      return [];
    },
  };
  await assert.rejects(
    patchTravelPhoto(
      "photo_12345678",
      { width: 3200 },
      "photo-revision-12345678",
      "owner@example.test",
      binding,
    ),
    (error) => error?.code === "immutable_dimensions" && error?.status === 400,
  );
  assert.equal(batchCalled, false);
});

test("travel aggregate mutations fail closed when compare-and-swap loses", async () => {
  const placeBinding = {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          return {
            id: "place_12345678",
            tripId: "trip_12345678",
            label: "New York",
            countryCode: "US",
            countryName: "United States of America",
            admin1Code: "US-NY",
            admin1Name: "New York",
            precision: "region",
            publicLat: 43,
            publicLng: -75.7,
            sortOrder: 0,
            revision: "place-revision-12345678",
            tripRevision: "trip-revision-12345678",
          };
        },
      };
    },
    async batch() {
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ];
    },
  };
  await assert.rejects(
    patchTravelPlace(
      "place_12345678",
      { label: "New York State" },
      "place-revision-12345678",
      "owner@example.test",
      placeBinding,
    ),
    (error) => error?.code === "revision_conflict" && error?.status === 409,
  );

  const photoBinding = {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          return {
            id: "photo_12345678",
            tripId: "trip_12345678",
            placeId: "place_12345678",
            altText: "A platform at night.",
            caption: null,
            capturedAt: "2025-10",
            capturePrecision: "month",
            width: 1600,
            height: 1067,
            sortOrder: 0,
            isCover: 1,
            storageKey: "private/travel/masters/upload_12345678/source.webp",
            revision: "photo-revision-12345678",
            tripRevision: "trip-revision-12345678",
          };
        },
      };
    },
    async batch() {
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ];
    },
  };
  await assert.rejects(
    patchTravelPhoto(
      "photo_12345678",
      { caption: "A revised caption." },
      "photo-revision-12345678",
      "owner@example.test",
      photoBinding,
    ),
    (error) => error?.code === "revision_conflict" && error?.status === 409,
  );
});

test("travel upload streaming, aggregate If-Match, and cleanup failures remain observable", async () => {
  const [media, http, maintenance] = await Promise.all([
    readFile(new URL("../lib/server/travel/media.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/travel/http.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/travel/maintenance.ts", import.meta.url), "utf8"),
  ]);
  const store = media.slice(
    media.indexOf("export async function storeTravelUpload"),
    media.indexOf("export async function deleteTravelMaster"),
  );
  assert.match(store, /boundedUploadStream\(/);
  assert.match(store, /bucket\.put\([\s\S]*rawKey/);
  assert.doesNotMatch(store, /request\.arrayBuffer\(|request\.bytes\(/);
  assert.equal(
    store.indexOf("await bucket.delete(rawKey)") <
      store.indexOf("await persistence.completeStorage"),
    true,
  );

  const uploadStart = http.slice(
    http.indexOf("export async function studioTravelUploadPost"),
    http.indexOf("export async function studioTravelUploadPut"),
  );
  const uploadFinalize = http.slice(
    http.indexOf("export async function studioTravelUploadFinalizePost"),
    http.indexOf("export async function studioTravelPhotoPatch"),
  );
  const uploadPut = http.slice(
    http.indexOf("export async function studioTravelUploadPut"),
    http.indexOf("export async function studioTravelUploadFinalizePost"),
  );
  for (const route of [uploadStart, uploadPut, uploadFinalize]) {
    assert.match(route, /strongRevision\(request\)/);
    assert.match(route, /revisionRequired\(\)/);
  }
  assert.match(store, /expectedTripRevision/);
  assert.match(store, /persistence\.getForWrite\([\s\S]*expectedTripRevision/);
  assert.match(store, /persistence\.markTemporary\([\s\S]*expectedTripRevision/);
  assert.match(store, /persistence\.completeStorage\([\s\S]*expectedTripRevision/);
  assert.match(media, /function repositoryUploadPersistence/);
  assert.match(media, /getTravelUploadForWrite\([\s\S]*expectedTripRevision/);
  assert.match(media, /markTravelUploadTemporaryStorage\([\s\S]*expectedTripRevision/);
  assert.match(media, /completeTravelUploadStorage\([\s\S]*expectedTripRevision/);
  const token = "t".repeat(43);
  const tokenDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const tokenHash = Array.from(
    new Uint8Array(tokenDigest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const uploadBinding = {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          return {
            id: "upload_12345678",
            tripId: "trip_12345678",
            tripRevision: "current-trip-revision",
            tokenHash,
            status: "issued",
            mediaType: "image/jpeg",
            declaredBytes: 100,
            storedBytes: null,
            processedWidth: null,
            processedHeight: null,
            storageKey: null,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
        },
      };
    },
  };
  await assert.rejects(
    getTravelUploadForWrite(
      "upload_12345678",
      token,
      "stale-trip-revision",
      uploadBinding,
    ),
    (error) => error?.code === "revision_conflict" && error?.status === 409,
  );
  assert.match(uploadFinalize, /"x-travel-trip-revision"/);

  assert.match(maintenance, /deletionFailures \+= 1/);
  assert.match(maintenance, /pendingDeletionCount/);
  assert.match(
    maintenance,
    /deletionFailures > 0 \|\| pendingDeletionCount > 0 \? "error" : "complete"/,
  );
  assert.match(maintenance, /last_error_code = 'r2_delete_failed'/);
});
