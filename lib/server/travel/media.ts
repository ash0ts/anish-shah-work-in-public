import type { TravelPhotoVariant } from "@/types/travel";
import { inspectTravelImage } from "./image-policy";
import { TRAVEL_UPLOAD_MAX_BYTES } from "./policy";
import {
  snapshotContainsPhoto,
  travelMediaDigest,
} from "./projector";
import { previewTravelAtlas } from "./preview";
import {
  completeTravelMediaDeletion,
  completeTravelUploadStorage,
  failTravelUpload,
  findPrivateTravelPhotoStorage,
  findPublishedTravelMedia,
  getTravelUploadForWrite,
  markTravelUploadTemporaryStorage,
  TravelRepositoryError,
  type TravelMediaDeletion,
  type TravelUploadRow,
} from "./repository";
import {
  travelImagesBinding,
  travelMediaBucket,
  travelPreviewRuntime,
  type TravelImagesBinding,
  type TravelR2Bucket,
} from "./runtime";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;
const MAX_SANITIZED_BYTES = 25 * 1024 * 1024;

/**
 * A deliberately narrow seam around the upload transaction writes. Runtime
 * callers always use the repository-backed default below; response-level
 * tests can exercise the streaming/R2/Images boundary without reimplementing
 * D1's SQL semantics in a mock.
 */
export type TravelUploadPersistence = {
  getForWrite(input: {
    uploadId: string;
    uploadToken: string;
    expectedTripRevision: string;
  }): Promise<TravelUploadRow>;
  markTemporary(input: {
    uploadId: string;
    rawKey: string;
    tripId: string;
    expectedTripRevision: string;
  }): Promise<void>;
  completeStorage(input: {
    uploadId: string;
    storageKey: string;
    storedBytes: number;
    processedWidth: number;
    processedHeight: number;
    actorEmail: string;
    tripId: string;
    expectedTripRevision: string;
  }): Promise<void>;
  fail(uploadId: string): Promise<void>;
};

function repositoryUploadPersistence(
  database: D1Database | null | undefined,
): TravelUploadPersistence {
  return {
    getForWrite: ({ uploadId, uploadToken, expectedTripRevision }) =>
      getTravelUploadForWrite(
        uploadId,
        uploadToken,
        expectedTripRevision,
        database,
      ),
    markTemporary: ({
      uploadId,
      rawKey,
      tripId,
      expectedTripRevision,
    }) =>
      markTravelUploadTemporaryStorage(
        uploadId,
        rawKey,
        tripId,
        expectedTripRevision,
        database,
      ),
    completeStorage: ({
      uploadId,
      storageKey,
      storedBytes,
      processedWidth,
      processedHeight,
      actorEmail,
      tripId,
      expectedTripRevision,
    }) =>
      completeTravelUploadStorage(
        uploadId,
        "issued",
        storageKey,
        storedBytes,
        processedWidth,
        processedHeight,
        actorEmail,
        tripId,
        expectedTripRevision,
        database,
      ),
    fail: (uploadId) => failTravelUpload(uploadId, database),
  };
}

function neutralTravelPreviewArtwork(): Response {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">',
    '<rect width="640" height="480" fill="#17223b"/>',
    '<circle cx="320" cy="240" r="154" fill="#295dff"/>',
    '<path d="M186 210h268M202 286h236M320 86c-54 54-82 105-82 154s28 100 82 154M320 86c54 54 82 105 82 154s-28 100-82 154" fill="none" stroke="#f4f7f8" stroke-width="12"/>',
    '<circle cx="408" cy="174" r="16" fill="#f04e85"/>',
    "</svg>",
  ].join("");
  return new Response(svg, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-preview-artwork": "synthetic-travel-placeholder",
      "x-robots-tag": "noindex, nofollow, noarchive, noimageindex",
    },
  });
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type TravelImageKind = "jpeg" | "png" | "webp" | "heic";

export function detectTravelImageKind(bytes: Uint8Array): TravelImageKind | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "png";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return "webp";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp" &&
    /^(?:heic|heix)$/i.test(
      new TextDecoder().decode(bytes.slice(8, 12)),
    )
  ) return "heic";
  return null;
}

function mediaTypeKind(value: string): TravelImageKind | null {
  if (value === "image/jpeg") return "jpeg";
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  if (value === "image/heic") return "heic";
  return null;
}

class TravelUploadBodyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "TravelUploadBodyError";
    this.status = status;
    this.code = code;
  }
}

function boundedUploadStream(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
  reportError: (error: TravelUploadBodyError) => void,
): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > TRAVEL_UPLOAD_MAX_BYTES) {
          const error = new TravelUploadBodyError(
            413,
            "request_too_large",
            "Image exceeds the 20 MB limit.",
          );
          reportError(error);
          throw error;
        }
        if (received > expectedBytes) {
          const error = new TravelUploadBodyError(
            400,
            "invalid_image_size",
            "Image size does not match the upload transaction.",
          );
          reportError(error);
          throw error;
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (received === 0) {
          const error = new TravelUploadBodyError(
            400,
            "missing_image",
            "An image body is required.",
          );
          reportError(error);
          throw error;
        }
        if (received !== expectedBytes) {
          const error = new TravelUploadBodyError(
            400,
            "invalid_image_size",
            "Image size does not match the upload transaction.",
          );
          reportError(error);
          throw error;
        }
      },
    }),
  );
}

async function boundedResponseBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function storeTravelUpload(input: {
  request: Request;
  uploadId: string;
  uploadToken: string;
  expectedTripRevision: string;
  actorEmail: string;
  database?: D1Database | null;
  bucket?: TravelR2Bucket | null;
  images?: TravelImagesBinding | null;
  persistence?: TravelUploadPersistence;
}): Promise<Response> {
  const bucket = input.bucket ?? travelMediaBucket();
  const images = input.images ?? travelImagesBinding();
  if (!bucket || !images) {
    return Response.json(
      {
        error: "Travel image processing is not configured.",
        code: "image_pipeline_unavailable",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  const persistence = input.persistence ?? repositoryUploadPersistence(input.database);
  const upload = await persistence.getForWrite({
    uploadId: input.uploadId,
    uploadToken: input.uploadToken,
    expectedTripRevision: input.expectedTripRevision,
  });
  const declaredLength = input.request.headers.get("content-length");
  if (declaredLength !== null && !/^\d+$/.test(declaredLength)) {
    return Response.json(
      { error: "Image size does not match the upload transaction.", code: "invalid_image_size" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (
    declaredLength !== null &&
    Number(declaredLength) > TRAVEL_UPLOAD_MAX_BYTES
  ) {
    return Response.json(
      { error: "Image exceeds the 20 MB limit.", code: "request_too_large" },
      { status: 413, headers: PRIVATE_HEADERS },
    );
  }
  if (
    declaredLength !== null &&
    Number(declaredLength) !== Number(upload.declaredBytes)
  ) {
    return Response.json(
      { error: "Image size does not match the upload transaction.", code: "invalid_image_size" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const mediaType = (input.request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== upload.mediaType) {
    return Response.json(
      { error: "Image type does not match the upload transaction.", code: "invalid_image_type" },
      { status: 415, headers: PRIVATE_HEADERS },
    );
  }
  if (!input.request.body) {
    return Response.json(
      { error: "An image body is required.", code: "missing_image" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const rawKey = `temporary/travel/${input.uploadId}/${crypto.randomUUID()}`;
  // Deterministic per-transaction naming lets retention remove a master even
  // if the isolate exits between the R2 write and the D1 completion update.
  const storageKey = `private/travel/masters/${input.uploadId}/source.webp`;
  let rawDeleted = false;
  let uploadBodyError: TravelUploadBodyError | null = null;
  try {
    await persistence.markTemporary({
      uploadId: input.uploadId,
      rawKey,
      tripId: upload.tripId,
      expectedTripRevision: input.expectedTripRevision,
    });
    await bucket.put(
      rawKey,
      boundedUploadStream(
        input.request.body,
        Number(upload.declaredBytes),
        (error) => {
          uploadBodyError = error;
        },
      ),
      {
      httpMetadata: { contentType: upload.mediaType },
      customMetadata: { lifecycle: "temporary" },
      },
    );
    const raw = await bucket.get(rawKey);
    if (
      !raw?.body ||
      raw.size !== Number(upload.declaredBytes) ||
      raw.size > TRAVEL_UPLOAD_MAX_BYTES
    ) {
      throw new TravelUploadBodyError(
        400,
        "invalid_image_size",
        "Image size does not match the upload transaction.",
      );
    }
    const bytes = await boundedResponseBytes(
      new Response(raw.body),
      TRAVEL_UPLOAD_MAX_BYTES,
    );
    const expectedKind = mediaTypeKind(upload.mediaType);
    const inspection = bytes && expectedKind
      ? inspectTravelImage(bytes, expectedKind)
      : null;
    if (!bytes || !inspection) {
      throw new TravelUploadBodyError(
        415,
        "invalid_image_signature",
        "Image bytes do not match the declared type.",
      );
    }
    const imageStream = new Response(ownedArrayBuffer(bytes)).body;
    if (!imageStream) throw new Error("image_stream_unavailable");
    const outputResult = await images
      .input(imageStream)
      .transform({
        width: 4096,
        height: 4096,
        fit: "scale-down",
        rotate: "auto",
        metadata: "none",
      })
      .output({ format: "image/webp", quality: 88 });
    const output = outputResult.response();
    const outputType = (output.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!output.ok || outputType !== "image/webp") {
      throw new Error("image_transform_failed");
    }
    const sanitized = await boundedResponseBytes(output, MAX_SANITIZED_BYTES);
    const sanitizedInspection = sanitized
      ? inspectTravelImage(sanitized, "webp")
      : null;
    if (!sanitized || sanitized.length === 0 || !sanitizedInspection) {
      throw new Error("image_transform_invalid");
    }
    await bucket.put(storageKey, sanitized, {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { metadata: "stripped", lifecycle: "master" },
    });
    await bucket.delete(rawKey);
    rawDeleted = true;
    await persistence.completeStorage({
      uploadId: input.uploadId,
      storageKey,
      storedBytes: sanitized.byteLength,
      processedWidth: sanitizedInspection.width,
      processedHeight: sanitizedInspection.height,
      actorEmail: input.actorEmail,
      tripId: upload.tripId,
      expectedTripRevision: input.expectedTripRevision,
    });
    return Response.json(
      { status: "uploaded", uploadId: input.uploadId },
      { status: 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await Promise.allSettled([
      bucket.delete(storageKey),
      persistence.fail(input.uploadId),
    ]);
    if (error instanceof TravelRepositoryError) throw error;
    const safeBodyError = error instanceof TravelUploadBodyError
      ? error
      : uploadBodyError;
    if (safeBodyError) {
      return Response.json(
        { error: safeBodyError.message, code: safeBodyError.code },
        { status: safeBodyError.status, headers: PRIVATE_HEADERS },
      );
    }
    return Response.json(
      {
        error: "The image could not be safely processed.",
        code: "image_processing_failed",
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  } finally {
    if (!rawDeleted) await bucket.delete(rawKey).catch(() => undefined);
  }
}

export async function deleteTravelMaster(storageKey: string): Promise<void> {
  const bucket = travelMediaBucket();
  if (
    !bucket ||
    (!storageKey.startsWith("private/travel/masters/") &&
      !storageKey.startsWith("temporary/travel/"))
  ) return;
  await bucket.delete(storageKey);
}

export async function travelVariantStorageKeys(
  photoId: string,
  storageKey: string,
): Promise<string[]> {
  const digest = await travelMediaDigest(photoId, storageKey);
  return (Object.keys(VARIANT_WIDTHS) as TravelPhotoVariant[]).map(
    (variant) =>
      `private/travel/variants/${photoId}/${digest}/${variant}.webp`,
  );
}

export async function deleteTravelMedia(
  photoId: string,
  storageKey: string,
  bucket: TravelR2Bucket | null = travelMediaBucket(),
): Promise<void> {
  if (!bucket || !storageKey.startsWith("private/travel/masters/")) return;
  await deleteTravelStorageKeys(
    [storageKey, ...(await travelVariantStorageKeys(photoId, storageKey))],
    bucket,
  );
}

function validTravelStorageKey(key: string): boolean {
  return (
    /^private\/travel\/masters\/upload_[A-Za-z0-9-]+\/source\.webp$/.test(key) ||
    /^private\/travel\/variants\/photo_[A-Za-z0-9-]+\/[a-f0-9]{64}\/(?:480|960|1920)\.webp$/.test(key) ||
    /^temporary\/travel\/upload_[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/.test(key)
  );
}

export async function deleteTravelStorageKeys(
  storageKeys: string[],
  bucket: TravelR2Bucket | null = travelMediaBucket(),
): Promise<void> {
  if (
    !bucket ||
    storageKeys.length === 0 ||
    storageKeys.length > 100 ||
    !storageKeys.every(validTravelStorageKey)
  ) {
    throw new Error("invalid_travel_media_deletion");
  }
  await bucket.delete([...new Set(storageKeys)]);
}

export async function processTravelMediaDeletion(
  deletion: TravelMediaDeletion,
): Promise<void> {
  await deleteTravelStorageKeys(deletion.storageKeys);
  await completeTravelMediaDeletion(deletion.id);
}

const VARIANT_WIDTHS: Record<TravelPhotoVariant, number> = {
  "480": 480,
  "960": 960,
  "1920": 1920,
};

export async function servePublishedTravelMedia(input: {
  photoId: string;
  digest: string;
  variant: TravelPhotoVariant;
  database?: D1Database | null;
  bucket?: TravelR2Bucket | null;
  images?: TravelImagesBinding | null;
  publicationLookup?: typeof findPublishedTravelMedia;
}): Promise<Response> {
  try {
    if (travelPreviewRuntime()) {
      const fixture = await previewTravelAtlas();
      return snapshotContainsPhoto(fixture, input.photoId, input.digest)
        ? neutralTravelPreviewArtwork()
        : new Response(null, {
            status: 404,
            headers: {
              "cache-control": "no-store",
              "x-robots-tag": "noindex, noimageindex",
            },
          });
    }
    const lookup = input.publicationLookup ?? findPublishedTravelMedia;
    // Publication authorization always precedes any R2 lookup. This is the
    // revocation boundary for unpublished photos and cached derivatives.
    const media = await lookup(
      input.photoId,
      input.digest,
      input.database,
    );
    if (!media || !media.storageKey.startsWith("private/travel/masters/")) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "no-store", "x-robots-tag": "noimageindex" },
      });
    }
    const bucket = input.bucket ?? travelMediaBucket();
    const images = input.images ?? travelImagesBinding();
    if (!bucket || !images) {
      return Response.json(
        { error: "Travel media is unavailable.", code: "media_unavailable" },
        {
          status: 503,
          headers: { "cache-control": "no-store", "x-robots-tag": "noimageindex" },
        },
      );
    }
    const variantKey =
      `private/travel/variants/${input.photoId}/${input.digest}/${input.variant}.webp`;
    const cached = await bucket.get(variantKey);
    if (cached?.body) {
      const cachedBytes = await boundedResponseBytes(
        new Response(cached.body),
        MAX_SANITIZED_BYTES,
      );
      if (cachedBytes && inspectTravelImage(cachedBytes, "webp")) {
        return new Response(ownedArrayBuffer(cachedBytes), {
          status: 200,
          headers: {
            "content-type": "image/webp",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "x-robots-tag": "noimageindex",
          },
        });
      }
      await bucket.delete(variantKey);
    }
    const object = await bucket.get(media.storageKey);
    if (!object?.body) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "no-store", "x-robots-tag": "noimageindex" },
      });
    }
    const outputResult = await images
      .input(object.body)
      .transform({
        width: VARIANT_WIDTHS[input.variant],
        fit: "scale-down",
        metadata: "none",
      })
      .output({ format: "image/webp", quality: 84 });
    const output = outputResult.response();
    if (!output.ok) {
      throw new Error("media_transform_failed");
    }
    const derivative = await boundedResponseBytes(output, MAX_SANITIZED_BYTES);
    if (!derivative || !inspectTravelImage(derivative, "webp")) {
      throw new Error("media_transform_invalid");
    }
    await bucket.put(variantKey, derivative, {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { lifecycle: "private-derivative" },
    });
    return new Response(ownedArrayBuffer(derivative), {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noimageindex",
      },
    });
  } catch {
    return Response.json(
      { error: "Travel media is unavailable.", code: "media_unavailable" },
      {
        status: 503,
        headers: { "cache-control": "no-store", "x-robots-tag": "noimageindex" },
      },
    );
  }
}

export async function servePrivateTravelPhotoPreview(
  photoId: string,
): Promise<Response> {
  const media = await findPrivateTravelPhotoStorage(photoId);
  if (!media) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  const bucket = travelMediaBucket();
  const images = travelImagesBinding();
  if (!bucket || !images) {
    return Response.json(
      { error: "Travel media is unavailable.", code: "media_unavailable" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  const object = await bucket.get(media.storageKey);
  if (!object?.body) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  const outputResult = await images
    .input(object.body)
    .transform({ width: 960, fit: "scale-down", metadata: "none" })
    .output({ format: "image/webp", quality: 82 });
  const output = outputResult.response();
  if (!output.ok || !output.body) {
    return Response.json(
      { error: "Travel media is unavailable.", code: "media_unavailable" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  return new Response(output.body, {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, noimageindex",
    },
  });
}
