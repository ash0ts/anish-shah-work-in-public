import type { TravelPhotoVariant } from "@/types/travel";
import { publicDatabaseError } from "../database-errors";
import {
  authorizeOwnerApi,
  rejectCrossOriginWrite,
} from "../owner-auth";
import { readBoundedJsonBody } from "../request-security";
import {
  processTravelMediaDeletion,
  servePrivateTravelPhotoPreview,
  servePublishedTravelMedia,
  storeTravelUpload,
} from "./media";
import {
  validId,
  validSlug,
  validateTravelPhotoInput,
  validateTravelPhotoMoveInput,
  validateTravelPlaceInput,
  validateTravelTripInput,
  validateTravelTripPatch,
  validateTravelUploadInput,
  type TravelPhotoInput,
  type TravelPlaceInput,
} from "./policy";
import {
  createTravelPlace,
  createTravelTrip,
  createTravelUpload,
  deleteTravelPhoto,
  deleteTravelPlace,
  deleteTravelTrip,
  finalizeTravelUpload,
  getPublicTravelAtlas,
  getPublicTravelTrip,
  getTravelTripDraft,
  getTravelTripDraftPreview,
  listTravelTripDrafts,
  moveTravelPhoto,
  patchTravelPhoto,
  patchTravelPlace,
  patchTravelTrip,
  publishTravelTrip,
  TravelRepositoryError,
} from "./repository";
import { travelAtlasEnabled } from "./runtime";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;
const PUBLIC_HEADERS = { "cache-control": "no-store" } as const;

type RouteContext = { params: Promise<Record<string, string>> };

function strongRevision(request: Request): string | null {
  const value = request.headers.get("if-match")?.trim();
  if (!value || value === "*" || value.startsWith("W/")) return null;
  const unquoted = value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
  return /^[a-f0-9-]{16,80}$/i.test(unquoted) ? unquoted : null;
}

function revisionRequired(): Response {
  return Response.json(
    {
      error: "A strong If-Match revision is required.",
      code: "revision_required",
    },
    { status: 428, headers: PRIVATE_HEADERS },
  );
}

function repositoryFailure(error: unknown): Response {
  if (error instanceof TravelRepositoryError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: PRIVATE_HEADERS },
    );
  }
  const safe = publicDatabaseError(error);
  return Response.json(
    { error: safe.message, code: safe.code },
    { status: 503, headers: PRIVATE_HEADERS },
  );
}

async function ownerMutation(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return { ok: false as const, response: crossOrigin };
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return { ok: false as const, response: authorization.response };
  return { ok: true as const, email: authorization.user.email };
}

async function pathParam(context: RouteContext, key: string): Promise<string | null> {
  const value = (await context.params)[key];
  return validId(value) ? value : null;
}

export async function publicTravelAtlasGet(): Promise<Response> {
  if (!travelAtlasEnabled()) return new Response(null, { status: 404, headers: PUBLIC_HEADERS });
  const result = await getPublicTravelAtlas();
  return Response.json(result, { status: 200, headers: PUBLIC_HEADERS });
}

function pageParameter(value: string | null): number | null {
  if (value === null) return 1;
  if (!/^\d{1,5}$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

function pageSizeParameter(value: string | null): 12 | 24 | 36 | null {
  if (value === null) return 12;
  const number = Number(value);
  return number === 12 || number === 24 || number === 36 ? number : null;
}

export async function publicTravelTripGet(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!travelAtlasEnabled()) return new Response(null, { status: 404, headers: PUBLIC_HEADERS });
  const slug = (await context.params).slug;
  const url = new URL(request.url);
  const page = pageParameter(url.searchParams.get("page"));
  const pageSize = pageSizeParameter(url.searchParams.get("pageSize"));
  if (!validSlug(slug) || page === null || pageSize === null) {
    return Response.json(
      { error: "Invalid trip query.", code: "invalid_query" },
      { status: 400, headers: PUBLIC_HEADERS },
    );
  }
  const result = await getPublicTravelTrip(slug, page, pageSize);
  return Response.json(result, {
    status: result.status === "not_found" ? 404 : 200,
    headers: PUBLIC_HEADERS,
  });
}

export async function publicTravelMediaGet(context: RouteContext): Promise<Response> {
  if (!travelAtlasEnabled()) return new Response(null, { status: 404, headers: PUBLIC_HEADERS });
  const { photoId, variant, digest } = await context.params;
  if (
    !validId(photoId) ||
    !(variant === "480" || variant === "960" || variant === "1920") ||
    !/^[a-f0-9]{64}$/.test(digest ?? "")
  ) {
    return new Response(null, { status: 404, headers: PUBLIC_HEADERS });
  }
  return servePublishedTravelMedia({
    photoId,
    variant: variant as TravelPhotoVariant,
    digest,
  });
}

export async function studioTravelTripsGet(): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  try {
    return Response.json(
      { trips: await listTravelTripDrafts() },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelTripsPost(request: Request): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const parsed = await readBoundedJsonBody(request, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;
  const validated = validateTravelTripInput(parsed.value);
  if (!validated.ok) {
    return Response.json(
      { error: validated.message, code: validated.code },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const trip = await createTravelTrip(validated.value, owner.email);
    return Response.json(
      { trip },
      {
        status: 201,
        headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(trip.revision) },
      },
    );
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelTripGet(context: RouteContext): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const tripId = await pathParam(context, "id");
  if (!tripId) return Response.json({ error: "Invalid trip id." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const trip = await getTravelTripDraft(tripId);
    return Response.json(
      { trip },
      { headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(trip.revision) } },
    );
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelTripPreviewGet(
  context: RouteContext,
): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const tripId = await pathParam(context, "id");
  if (!tripId) {
    return Response.json(
      { error: "Invalid trip id." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const preview = await getTravelTripDraftPreview(tripId);
    return Response.json({ preview }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelTripPatch(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const tripId = await pathParam(context, "id");
  if (!tripId) return Response.json({ error: "Invalid trip id." }, { status: 400, headers: PRIVATE_HEADERS });
  const parsed = await readBoundedJsonBody(request, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;
  const validated = validateTravelTripPatch(parsed.value);
  if (!validated.ok) return Response.json({ error: validated.message, code: validated.code }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const trip = await patchTravelTrip(tripId, validated.value, revision, owner.email);
    return Response.json({ trip }, { headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(trip.revision) } });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelTripDelete(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const tripId = await pathParam(context, "id");
  if (!tripId) return Response.json({ error: "Invalid trip id." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const deleted = await deleteTravelTrip(tripId, revision, owner.email);
    await Promise.allSettled(
      deleted.deletions.map((deletion) =>
        processTravelMediaDeletion(deletion)),
    );
    return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPlacePost(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const tripId = await pathParam(context, "id");
  if (!tripId) return Response.json({ error: "Invalid trip id." }, { status: 400, headers: PRIVATE_HEADERS });
  const parsed = await readBoundedJsonBody(request, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;
  const validated = validateTravelPlaceInput(parsed.value);
  if (!validated.ok) return Response.json({ error: validated.message, code: validated.code }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const place = await createTravelPlace(
      tripId,
      validated.value as TravelPlaceInput,
      revision,
      owner.email,
    );
    return Response.json(
      { place },
      { status: 201, headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(place.revision) } },
    );
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPlacePatch(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const placeId = await pathParam(context, "id");
  if (!placeId) return Response.json({ error: "Invalid place id." }, { status: 400, headers: PRIVATE_HEADERS });
  const parsed = await readBoundedJsonBody(request, { maxBytes: 4_096 });
  if (!parsed.ok) return parsed.response;
  const validated = validateTravelPlaceInput(parsed.value, { partial: true });
  if (!validated.ok) return Response.json({ error: validated.message, code: validated.code }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const place = await patchTravelPlace(placeId, validated.value, revision, owner.email);
    return Response.json({ place }, { headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(place.revision) } });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPlaceDelete(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const placeId = await pathParam(context, "id");
  if (!placeId) return Response.json({ error: "Invalid place id." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    await deleteTravelPlace(placeId, revision, owner.email);
    return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelUploadPost(request: Request): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const parsed = await readBoundedJsonBody(request, { maxBytes: 2_048 });
  if (!parsed.ok) return parsed.response;
  const validated = validateTravelUploadInput(parsed.value);
  if (!validated.ok) return Response.json({ error: validated.message, code: validated.code }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const transaction = await createTravelUpload(
      validated.value,
      revision,
      owner.email,
      new URL(request.url).origin,
    );
    return Response.json({ transaction }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelUploadPut(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const uploadId = await pathParam(context, "id");
  const token = request.headers.get("x-travel-upload-token")?.trim() ?? "";
  if (!uploadId || !/^[A-Za-z0-9_-]{40,80}$/.test(token)) {
    return Response.json({ error: "Invalid upload transaction." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    return await storeTravelUpload({
      request,
      uploadId,
      uploadToken: token,
      expectedTripRevision: revision,
      actorEmail: owner.email,
    });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelUploadFinalizePost(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const uploadId = await pathParam(context, "id");
  if (!uploadId) return Response.json({ error: "Invalid upload id." }, { status: 400, headers: PRIVATE_HEADERS });
  const parsed = await readBoundedJsonBody(request, { maxBytes: 8_192 });
  if (!parsed.ok) return parsed.response;
  const validated = validateTravelPhotoInput(parsed.value);
  if (!validated.ok) return Response.json({ error: validated.message, code: validated.code }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const finalized = await finalizeTravelUpload(
      uploadId,
      validated.value as TravelPhotoInput,
      revision,
      owner.email,
    );
    return Response.json(
      finalized,
      {
        status: 201,
        headers: {
          ...PRIVATE_HEADERS,
          etag: JSON.stringify(finalized.photo.revision),
          "x-travel-trip-revision": finalized.tripRevision,
        },
      },
    );
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPhotoPatch(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const photoId = await pathParam(context, "id");
  if (!photoId) return Response.json({ error: "Invalid photo id." }, { status: 400, headers: PRIVATE_HEADERS });
  const parsed = await readBoundedJsonBody(request, { maxBytes: 8_192 });
  if (!parsed.ok) return parsed.response;
  const move = validateTravelPhotoMoveInput(parsed.value);
  if (move.ok) {
    try {
      const trip = await moveTravelPhoto(
        photoId,
        move.value.direction,
        move.value.photoRevision,
        revision,
        owner.email,
      );
      return Response.json(
        { trip },
        {
          headers: {
            ...PRIVATE_HEADERS,
            etag: JSON.stringify(trip.revision),
            "x-travel-trip-revision": trip.revision,
          },
        },
      );
    } catch (error) {
      return repositoryFailure(error);
    }
  }
  const validated = validateTravelPhotoInput(parsed.value, { partial: true });
  if (!validated.ok) return Response.json({ error: validated.message, code: validated.code }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const photo = await patchTravelPhoto(photoId, validated.value, revision, owner.email);
    return Response.json({ photo }, { headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(photo.revision) } });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPhotoPreviewGet(
  context: RouteContext,
): Promise<Response> {
  const authorization = await authorizeOwnerApi();
  if (!authorization.ok) return authorization.response;
  const photoId = await pathParam(context, "id");
  if (!photoId) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  try {
    return await servePrivateTravelPhotoPreview(photoId);
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPhotoDelete(request: Request, context: RouteContext): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const photoId = await pathParam(context, "id");
  if (!photoId) return Response.json({ error: "Invalid photo id." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const deleted = await deleteTravelPhoto(photoId, revision, owner.email);
    await processTravelMediaDeletion(deleted.deletion).catch(() => undefined);
    return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function studioTravelPublicationPost(
  request: Request,
  context: RouteContext,
  publish: boolean,
): Promise<Response> {
  const owner = await ownerMutation(request);
  if (!owner.ok) return owner.response;
  const revision = strongRevision(request);
  if (!revision) return revisionRequired();
  const tripId = await pathParam(context, "id");
  if (!tripId) return Response.json({ error: "Invalid trip id." }, { status: 400, headers: PRIVATE_HEADERS });
  const parsed = await readBoundedJsonBody(request, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const confirmation = parsed.value;
  if (
    typeof confirmation !== "object" ||
    confirmation === null ||
    Array.isArray(confirmation) ||
    Object.keys(confirmation).length !== 1 ||
    (confirmation as Record<string, unknown>).confirmWholeTrip !== true
  ) {
    return Response.json(
      {
        error: "Confirm whole-trip publication or removal.",
        code: "whole_trip_confirmation_required",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const trip = await publishTravelTrip(tripId, revision, owner.email, publish);
    return Response.json({ trip }, { headers: { ...PRIVATE_HEADERS, etag: JSON.stringify(trip.revision) } });
  } catch (error) {
    return repositoryFailure(error);
  }
}
