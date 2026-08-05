import {
  TRAVEL_DATE_PRECISIONS,
  TRAVEL_PLACE_PRECISIONS,
  TRAVEL_TRIP_STATUSES,
  type TravelDatePrecision,
  type TravelPeriod,
  type TravelPlacePrecision,
  type TravelTripStatus,
} from "@/types/travel";
import { normalizeTrustedTravelPlace } from "./geography-policy";

export const TRAVEL_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const TRAVEL_ACCEPTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type TravelValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export type TravelTripInput = {
  title: string;
  summary: string;
  status: TravelTripStatus;
  period: TravelPeriod;
};

export type TravelTripPatch = Partial<TravelTripInput>;

export type TravelPlaceInput = {
  label: string;
  countryCode: string;
  countryName: string;
  admin1Code: string | null;
  admin1Name: string | null;
  precision: TravelPlacePrecision;
  publicPoint: { lat: number; lng: number };
  sortOrder: number;
};

export type TravelPhotoInput = {
  placeId: string | null;
  altText: string;
  caption: string | null;
  capturedAt: string | null;
  capturePrecision: TravelDatePrecision | null;
  width: number;
  height: number;
  tags: string[];
  sortOrder: number;
  isCover: boolean;
};

export type TravelPhotoMoveInput = {
  operation: "move";
  direction: "earlier" | "later";
  photoRevision: string;
};

export type TravelUploadInput = {
  tripId: string;
  mediaType: (typeof TRAVEL_ACCEPTED_MEDIA_TYPES)[number];
  byteSize: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function plainText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\r\n?/g, "\n");
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ||
    /<\/?(?:script|iframe|object|embed|svg|html|body)\b/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function optionalPlainText(
  value: unknown,
  maximum: number,
): string | null | undefined {
  if (value === null) return null;
  const parsed = plainText(value, 1, maximum);
  return parsed ?? undefined;
}

function isDatePrecision(value: unknown): value is TravelDatePrecision {
  return TRAVEL_DATE_PRECISIONS.includes(value as TravelDatePrecision);
}

function isTripStatus(value: unknown): value is TravelTripStatus {
  return TRAVEL_TRIP_STATUSES.includes(value as TravelTripStatus);
}

function isPlacePrecision(value: unknown): value is TravelPlacePrecision {
  return TRAVEL_PLACE_PRECISIONS.includes(value as TravelPlacePrecision);
}

function validPreciseDate(value: string, precision: TravelDatePrecision): boolean {
  if (precision === "year") return /^(?:19|20)\d{2}$/.test(value);
  if (precision === "month") {
    return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
  }
  return (
    /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(
      value,
    ) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value)
  );
}

export function validateTravelPeriod(value: unknown): TravelPeriod | null {
  const candidate = record(value);
  if (!candidate || !exactKeys(candidate, ["start", "end", "precision"])) {
    return null;
  }
  if (
    typeof candidate.start !== "string" ||
    !isDatePrecision(candidate.precision) ||
    !(candidate.end === null || typeof candidate.end === "string") ||
    !validPreciseDate(candidate.start, candidate.precision) ||
    (candidate.end !== null &&
      !validPreciseDate(candidate.end, candidate.precision)) ||
    (typeof candidate.end === "string" && candidate.end < candidate.start)
  ) {
    return null;
  }
  return {
    start: candidate.start,
    end: candidate.end as string | null,
    precision: candidate.precision,
  };
}

export function validateTravelTripInput(
  value: unknown,
): TravelValidationResult<TravelTripInput> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["title", "summary", "status", "period"])
  ) {
    return {
      ok: false,
      code: "invalid_trip",
      message: "Trip fields are incomplete or contain an unknown field.",
    };
  }
  const title = plainText(candidate.title, 1, 120);
  const summary = plainText(candidate.summary, 1, 1_200);
  const period = validateTravelPeriod(candidate.period);
  if (!title || !summary || !isTripStatus(candidate.status) || !period) {
    return {
      ok: false,
      code: "invalid_trip",
      message: "Trip title, summary, status, or period is invalid.",
    };
  }
  return { ok: true, value: { title, summary, status: candidate.status, period } };
}

export function validateTravelTripPatch(
  value: unknown,
): TravelValidationResult<TravelTripPatch> {
  const candidate = record(value);
  const allowed = ["title", "summary", "status", "period"] as const;
  if (
    !candidate ||
    Object.keys(candidate).length === 0 ||
    !exactKeys(candidate, allowed, [])
  ) {
    return {
      ok: false,
      code: "invalid_trip_patch",
      message: "Provide at least one recognized trip field.",
    };
  }
  const patch: TravelTripPatch = {};
  if (Object.hasOwn(candidate, "title")) {
    const title = plainText(candidate.title, 1, 120);
    if (!title) return invalidPatch();
    patch.title = title;
  }
  if (Object.hasOwn(candidate, "summary")) {
    const summary = plainText(candidate.summary, 1, 1_200);
    if (!summary) return invalidPatch();
    patch.summary = summary;
  }
  if (Object.hasOwn(candidate, "status")) {
    if (!isTripStatus(candidate.status)) return invalidPatch();
    patch.status = candidate.status;
  }
  if (Object.hasOwn(candidate, "period")) {
    const period = validateTravelPeriod(candidate.period);
    if (!period) return invalidPatch();
    patch.period = period;
  }
  return { ok: true, value: patch };
}

function invalidPatch(): TravelValidationResult<never> {
  return {
    ok: false,
    code: "invalid_trip_patch",
    message: "One or more trip fields are invalid.",
  };
}

function countryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function adminCode(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{0,15}$/.test(normalized)
    ? normalized
    : undefined;
}

function publicPoint(value: unknown): { lat: number; lng: number } | null {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["lat", "lng"]) ||
    typeof candidate.lat !== "number" ||
    typeof candidate.lng !== "number" ||
    !Number.isFinite(candidate.lat) ||
    !Number.isFinite(candidate.lng) ||
    candidate.lat < -90 ||
    candidate.lat > 90 ||
    candidate.lng < -180 ||
    candidate.lng > 180
  ) {
    return null;
  }
  return {
    lat: Math.round(candidate.lat * 10) / 10,
    lng: Math.round(candidate.lng * 10) / 10,
  };
}

export function validateTravelPlaceInput(
  value: unknown,
  options: { partial?: boolean } = {},
): TravelValidationResult<TravelPlaceInput | Partial<TravelPlaceInput>> {
  const candidate = record(value);
  const fields = [
    "label",
    "countryCode",
    "countryName",
    "admin1Code",
    "admin1Name",
    "precision",
    "publicPoint",
    "sortOrder",
  ] as const;
  const required = [
    "label",
    "countryCode",
    "countryName",
    "admin1Code",
    "admin1Name",
    "precision",
    "publicPoint",
    "sortOrder",
  ] as const;
  if (
    !candidate ||
    !exactKeys(candidate, fields, options.partial ? [] : required) ||
    (options.partial && Object.keys(candidate).length === 0)
  ) {
    return invalidPlace();
  }
  const result: Partial<TravelPlaceInput> = {};
  if (Object.hasOwn(candidate, "label")) {
    const label = plainText(candidate.label, 1, 100);
    if (!label) return invalidPlace();
    result.label = label;
  }
  if (Object.hasOwn(candidate, "countryCode")) {
    const parsed = countryCode(candidate.countryCode);
    if (!parsed) return invalidPlace();
    result.countryCode = parsed;
  }
  if (Object.hasOwn(candidate, "countryName")) {
    const parsed = plainText(candidate.countryName, 1, 100);
    if (!parsed) return invalidPlace();
    result.countryName = parsed;
  }
  if (Object.hasOwn(candidate, "admin1Code")) {
    const parsed = adminCode(candidate.admin1Code);
    if (parsed === undefined) return invalidPlace();
    result.admin1Code = parsed;
  }
  if (Object.hasOwn(candidate, "admin1Name")) {
    const parsed = optionalPlainText(candidate.admin1Name, 100);
    if (parsed === undefined) return invalidPlace();
    result.admin1Name = parsed;
  }
  if (Object.hasOwn(candidate, "precision")) {
    if (!isPlacePrecision(candidate.precision)) return invalidPlace();
    result.precision = candidate.precision;
  }
  if (Object.hasOwn(candidate, "publicPoint")) {
    const parsed = publicPoint(candidate.publicPoint);
    if (!parsed) return invalidPlace();
    result.publicPoint = parsed;
  }
  if (Object.hasOwn(candidate, "sortOrder")) {
    if (
      !Number.isInteger(candidate.sortOrder) ||
      Number(candidate.sortOrder) < -10_000 ||
      Number(candidate.sortOrder) > 10_000
    ) {
      return invalidPlace();
    }
    result.sortOrder = Number(candidate.sortOrder);
  }
  const hasAdminCode = Object.hasOwn(candidate, "admin1Code");
  const hasAdminName = Object.hasOwn(candidate, "admin1Name");
  if (
    hasAdminCode !== hasAdminName ||
    (hasAdminCode &&
      ((result.admin1Code === null) !== (result.admin1Name === null)))
  ) {
    return invalidPlace();
  }
  if (!options.partial) {
    const normalized = normalizeTrustedTravelPlace(result as TravelPlaceInput);
    if (!normalized) return invalidPlace();
    return { ok: true, value: normalized };
  }
  return { ok: true, value: result };
}

function invalidPlace(): TravelValidationResult<never> {
  return {
    ok: false,
    code: "invalid_place",
    message: "Place fields are incomplete, invalid, or contain an unknown field.",
  };
}

function tags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const normalized = value.map((entry) =>
    typeof entry === "string" ? entry.trim().toLocaleLowerCase() : "",
  );
  if (
    normalized.some(
      (entry) => !entry || entry.length > 40 || !/^[\p{L}\p{N}][\p{L}\p{N} .&+/'-]*$/u.test(entry),
    ) ||
    new Set(normalized).size !== normalized.length
  ) {
    return null;
  }
  return normalized;
}

export function validateTravelPhotoInput(
  value: unknown,
  options: { partial?: boolean } = {},
): TravelValidationResult<TravelPhotoInput | Partial<TravelPhotoInput>> {
  const candidate = record(value);
  const fields = [
    "placeId",
    "altText",
    "caption",
    "capturedAt",
    "capturePrecision",
    "width",
    "height",
    "tags",
    "sortOrder",
    "isCover",
  ] as const;
  if (
    !candidate ||
    !exactKeys(candidate, fields, options.partial ? [] : fields) ||
    (options.partial && Object.keys(candidate).length === 0)
  ) {
    return invalidPhoto();
  }
  const result: Partial<TravelPhotoInput> = {};
  if (Object.hasOwn(candidate, "placeId")) {
    if (!(candidate.placeId === null || validId(candidate.placeId))) {
      return invalidPhoto();
    }
    result.placeId = candidate.placeId as string | null;
  }
  if (Object.hasOwn(candidate, "altText")) {
    const parsed = plainText(candidate.altText, 1, 300);
    if (!parsed) return invalidPhoto();
    result.altText = parsed;
  }
  if (Object.hasOwn(candidate, "caption")) {
    const parsed = optionalPlainText(candidate.caption, 600);
    if (parsed === undefined) return invalidPhoto();
    result.caption = parsed;
  }
  if (
    Object.hasOwn(candidate, "capturedAt") ||
    Object.hasOwn(candidate, "capturePrecision")
  ) {
    if (
      !(candidate.capturedAt === null && candidate.capturePrecision === null) &&
      !(
        typeof candidate.capturedAt === "string" &&
        isDatePrecision(candidate.capturePrecision) &&
        validPreciseDate(candidate.capturedAt, candidate.capturePrecision)
      )
    ) {
      return invalidPhoto();
    }
    result.capturedAt = candidate.capturedAt as string | null;
    result.capturePrecision = candidate.capturePrecision as TravelDatePrecision | null;
  }
  for (const dimension of ["width", "height"] as const) {
    if (Object.hasOwn(candidate, dimension)) {
      const number = candidate[dimension];
      if (!Number.isInteger(number) || Number(number) < 1 || Number(number) > 12_000) {
        return invalidPhoto();
      }
      result[dimension] = Number(number);
    }
  }
  if (Object.hasOwn(candidate, "tags")) {
    const parsed = tags(candidate.tags);
    if (!parsed) return invalidPhoto();
    result.tags = parsed;
  }
  if (Object.hasOwn(candidate, "sortOrder")) {
    if (
      !Number.isInteger(candidate.sortOrder) ||
      Number(candidate.sortOrder) < -10_000 ||
      Number(candidate.sortOrder) > 10_000
    ) {
      return invalidPhoto();
    }
    result.sortOrder = Number(candidate.sortOrder);
  }
  if (Object.hasOwn(candidate, "isCover")) {
    if (typeof candidate.isCover !== "boolean") return invalidPhoto();
    result.isCover = candidate.isCover;
  }
  return { ok: true, value: result };
}

export function validateTravelPhotoMoveInput(
  value: unknown,
): TravelValidationResult<TravelPhotoMoveInput> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["operation", "direction", "photoRevision"]) ||
    candidate.operation !== "move" ||
    !(candidate.direction === "earlier" || candidate.direction === "later") ||
    typeof candidate.photoRevision !== "string" ||
    !/^[a-f0-9-]{16,80}$/i.test(candidate.photoRevision)
  ) {
    return {
      ok: false,
      code: "invalid_photo_move",
      message: "Photo move fields are incomplete or invalid.",
    };
  }
  return {
    ok: true,
    value: {
      operation: "move",
      direction: candidate.direction,
      photoRevision: candidate.photoRevision,
    },
  };
}

function invalidPhoto(): TravelValidationResult<never> {
  return {
    ok: false,
    code: "invalid_photo",
    message: "Photo fields are incomplete, invalid, or contain an unknown field.",
  };
}

export function validateTravelUploadInput(
  value: unknown,
): TravelValidationResult<TravelUploadInput> {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["tripId", "mediaType", "byteSize"]) ||
    !validId(candidate.tripId) ||
    !TRAVEL_ACCEPTED_MEDIA_TYPES.includes(
      candidate.mediaType as TravelUploadInput["mediaType"],
    ) ||
    !Number.isSafeInteger(candidate.byteSize) ||
    Number(candidate.byteSize) < 1 ||
    Number(candidate.byteSize) > TRAVEL_UPLOAD_MAX_BYTES
  ) {
    return {
      ok: false,
      code: "invalid_upload",
      message: "Upload metadata is invalid or exceeds the 20 MB limit.",
    };
  }
  return {
    ok: true,
    value: {
      tripId: candidate.tripId as string,
      mediaType: candidate.mediaType as TravelUploadInput["mediaType"],
      byteSize: Number(candidate.byteSize),
    },
  };
}

export function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9:_-]{7,79}$/i.test(value);
}

export function validSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value);
}

export function publicationSafetyIssue(input: {
  status: TravelTripStatus;
  period: TravelPeriod;
  places: Array<{ precision: TravelPlacePrecision }>;
  photoCount: number;
}): string | null {
  if (input.status === "completed") return null;
  if (input.period.precision === "day") {
    return "Planned and current trips must use month- or year-level dates.";
  }
  if (input.places.some((place) => place.precision === "city_approximate")) {
    return "Planned and current trips cannot publish approximate-city pins.";
  }
  if (input.photoCount > 0) {
    return "Planned and current trips cannot publish photos.";
  }
  return null;
}

export function normalizeTravelSlug(title: string, suffix: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
  return `${base || "trip"}-${suffix.toLocaleLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}
