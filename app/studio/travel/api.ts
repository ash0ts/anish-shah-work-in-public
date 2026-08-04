import type {
  StudioTravelPhoto,
  StudioTravelPlace,
  StudioTravelTrip,
  TravelPhotoPatch,
  TravelPhotoMoveDirection,
  TravelPlaceDraft,
  TravelTripDraft,
  TravelUploadTransaction,
} from "./contracts.ts";
import { quoteRevision } from "./contracts.ts";
import type { TravelTripPreview } from "@/types/travel";

type ErrorEnvelope = {
  error?: string;
  code?: string;
};

async function responseJson<T>(response: Response): Promise<T & ErrorEnvelope> {
  try {
    return (await response.json()) as T & ErrorEnvelope;
  } catch {
    return {} as T & ErrorEnvelope;
  }
}

async function requireResult<T>(
  response: Response,
  read: (body: Record<string, unknown>) => T | null,
  fallback: string,
): Promise<T> {
  const body = await responseJson<Record<string, unknown>>(response);
  const value = read(body);
  if (!response.ok || value === null) {
    throw new Error(body.error ?? fallback);
  }
  return value;
}

export async function listTravelTrips(): Promise<StudioTravelTrip[]> {
  const response = await fetch("/api/studio/travel/trips", {
    cache: "no-store",
    credentials: "same-origin",
  });
  return requireResult(
    response,
    (body) => (Array.isArray(body.trips) ? (body.trips as StudioTravelTrip[]) : null),
    "Travel trips could not be loaded.",
  );
}

export async function getTravelTrip(
  tripId: string,
): Promise<StudioTravelTrip> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(tripId)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return requireResult(
    response,
    (body) => (body.trip ? (body.trip as StudioTravelTrip) : null),
    "The trip could not be refreshed.",
  );
}

export async function getTravelTripPreview(
  tripId: string,
): Promise<TravelTripPreview> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(tripId)}/preview`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return requireResult(
    response,
    (body) =>
      body.preview ? (body.preview as TravelTripPreview) : null,
    "The exact public preview could not be projected.",
  );
}

export async function createTravelTrip(
  draft: TravelTripDraft,
): Promise<StudioTravelTrip> {
  const response = await fetch("/api/studio/travel/trips", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  return requireResult(
    response,
    (body) => (body.trip ? (body.trip as StudioTravelTrip) : null),
    "The trip could not be created.",
  );
}

export async function updateTravelTrip(
  trip: StudioTravelTrip,
  draft: TravelTripDraft,
): Promise<StudioTravelTrip> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(trip.id)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(trip.revision),
      },
      body: JSON.stringify(draft),
    },
  );
  return requireResult(
    response,
    (body) => (body.trip ? (body.trip as StudioTravelTrip) : null),
    "The trip changes could not be saved.",
  );
}

export async function deleteTravelTrip(
  trip: StudioTravelTrip,
): Promise<void> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(trip.id)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "if-match": quoteRevision(trip.revision) },
    },
  );
  if (!response.ok) {
    const body = await responseJson<Record<string, unknown>>(response);
    throw new Error(body.error ?? "The trip could not be deleted.");
  }
}

export async function createTravelPlace(
  trip: StudioTravelTrip,
  draft: TravelPlaceDraft,
): Promise<StudioTravelPlace> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(trip.id)}/places`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(trip.revision),
      },
      body: JSON.stringify(draft),
    },
  );
  return requireResult(
    response,
    (body) => (body.place ? (body.place as StudioTravelPlace) : null),
    "The place could not be added.",
  );
}

export async function updateTravelPlace(
  place: StudioTravelPlace,
  draft: TravelPlaceDraft,
): Promise<StudioTravelPlace> {
  const response = await fetch(
    `/api/studio/travel/places/${encodeURIComponent(place.id)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(place.revision),
      },
      body: JSON.stringify(draft),
    },
  );
  return requireResult(
    response,
    (body) => (body.place ? (body.place as StudioTravelPlace) : null),
    "The place could not be updated.",
  );
}

export async function deleteTravelPlace(
  place: StudioTravelPlace,
): Promise<void> {
  const response = await fetch(
    `/api/studio/travel/places/${encodeURIComponent(place.id)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "if-match": quoteRevision(place.revision) },
    },
  );
  if (!response.ok) {
    const body = await responseJson<Record<string, unknown>>(response);
    throw new Error(body.error ?? "The place could not be removed.");
  }
}

export async function beginTravelUpload(input: {
  tripId: string;
  tripRevision: string;
  mimeType: string;
  byteSize: number;
}): Promise<TravelUploadTransaction> {
  const response = await fetch("/api/studio/travel/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "if-match": quoteRevision(input.tripRevision),
    },
    body: JSON.stringify({
      tripId: input.tripId,
      mediaType: input.mimeType,
      byteSize: input.byteSize,
    }),
  });
  return requireResult(
    response,
    (body) =>
      body.transaction ? (body.transaction as TravelUploadTransaction) : null,
    "The secure upload could not be started.",
  );
}

export async function putTravelUpload(
  upload: TravelUploadTransaction,
  file: File,
): Promise<void> {
  const uploadUrl = new URL(upload.uploadUrl, window.location.origin);
  const expectedPath = `/api/studio/travel/uploads/${encodeURIComponent(upload.id)}`;
  if (
    uploadUrl.origin !== window.location.origin ||
    uploadUrl.pathname !== expectedPath ||
    uploadUrl.search ||
    uploadUrl.hash
  ) {
    throw new Error("The secure upload destination was rejected.");
  }
  const response = await fetch(uploadUrl.href, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "content-type": file.type,
      "x-travel-upload-token": upload.uploadToken,
      "if-match": quoteRevision(upload.tripRevision),
    },
    body: file,
  });
  if (!response.ok) {
    const body = await responseJson<Record<string, unknown>>(response);
    throw new Error(body.error ?? "The photo bytes could not be uploaded.");
  }
}

export async function finalizeTravelUpload(
  uploadId: string,
  patch: TravelPhotoPatch,
  tripRevision: string,
): Promise<{ photo: StudioTravelPhoto; tripRevision: string }> {
  const response = await fetch(
    `/api/studio/travel/uploads/${encodeURIComponent(uploadId)}/finalize`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(tripRevision),
      },
      body: JSON.stringify(patch),
    },
  );
  return requireResult(
    response,
    (body) =>
      body.photo && typeof body.tripRevision === "string"
        ? {
            photo: body.photo as StudioTravelPhoto,
            tripRevision: body.tripRevision,
          }
        : null,
    "The uploaded photo could not be processed.",
  );
}

export async function updateTravelPhoto(
  photo: StudioTravelPhoto,
  patch: Partial<Omit<TravelPhotoPatch, "sortOrder">>,
): Promise<StudioTravelPhoto> {
  const response = await fetch(
    `/api/studio/travel/photos/${encodeURIComponent(photo.id)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(photo.revision),
      },
      body: JSON.stringify(patch),
    },
  );
  return requireResult(
    response,
    (body) => (body.photo ? (body.photo as StudioTravelPhoto) : null),
    "The photo changes could not be saved.",
  );
}

export async function moveTravelPhoto(
  photo: StudioTravelPhoto,
  trip: StudioTravelTrip,
  direction: TravelPhotoMoveDirection,
): Promise<StudioTravelTrip> {
  const response = await fetch(
    `/api/studio/travel/photos/${encodeURIComponent(photo.id)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(trip.revision),
      },
      body: JSON.stringify({
        operation: "move",
        direction,
        photoRevision: photo.revision,
      }),
    },
  );
  return requireResult(
    response,
    (body) => (body.trip ? (body.trip as StudioTravelTrip) : null),
    "The photo could not be moved.",
  );
}

export async function deleteTravelPhoto(
  photo: StudioTravelPhoto,
): Promise<void> {
  const response = await fetch(
    `/api/studio/travel/photos/${encodeURIComponent(photo.id)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "if-match": quoteRevision(photo.revision) },
    },
  );
  if (!response.ok) {
    const body = await responseJson<Record<string, unknown>>(response);
    throw new Error(body.error ?? "The photo could not be removed.");
  }
}

export async function publishTravelTrip(
  trip: StudioTravelTrip,
): Promise<StudioTravelTrip> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(trip.id)}/publish`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(trip.revision),
      },
      body: JSON.stringify({ confirmWholeTrip: true }),
    },
  );
  return requireResult(
    response,
    (body) => (body.trip ? (body.trip as StudioTravelTrip) : null),
    "The trip could not be published.",
  );
}

export async function unpublishTravelTrip(
  trip: StudioTravelTrip,
): Promise<StudioTravelTrip> {
  const response = await fetch(
    `/api/studio/travel/trips/${encodeURIComponent(trip.id)}/unpublish`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": quoteRevision(trip.revision),
      },
      body: JSON.stringify({ confirmWholeTrip: true }),
    },
  );
  return requireResult(
    response,
    (body) => (body.trip ? (body.trip as StudioTravelTrip) : null),
    "The trip could not be unpublished.",
  );
}
