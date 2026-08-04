export const TRAVEL_TRIP_STATUSES = [
  "planned",
  "current",
  "completed",
] as const;

export type TravelTripStatus = (typeof TRAVEL_TRIP_STATUSES)[number];

export const TRAVEL_DATE_PRECISIONS = ["year", "month", "day"] as const;
export type TravelDatePrecision = (typeof TRAVEL_DATE_PRECISIONS)[number];

export const TRAVEL_PLACE_PRECISIONS = [
  "country",
  "region",
  "city_approximate",
] as const;
export type TravelPlacePrecision = (typeof TRAVEL_PLACE_PRECISIONS)[number];

export const TRAVEL_PHOTO_VARIANTS = ["480", "960", "1920"] as const;
export type TravelPhotoVariant = (typeof TRAVEL_PHOTO_VARIANTS)[number];

export type TravelPeriod = {
  start: string;
  end: string | null;
  precision: TravelDatePrecision;
};

export type TravelPhotoRef = {
  id: string;
  alt: string;
  caption: string | null;
  capturedAt: string | null;
  capturePrecision: TravelDatePrecision | null;
  width: number;
  height: number;
  aspectRatio: number;
  mediaDigest: string;
  tags: string[];
};

export type TravelPlaceSummary = {
  id: string;
  label: string;
  countryCode: string;
  countryName: string;
  admin1Code: string | null;
  admin1Name: string | null;
  precision: TravelPlacePrecision;
  publicPoint: { lat: number; lng: number };
  tripCount: number;
  photoCount: number;
};

export type TravelTripSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: TravelTripStatus;
  period: TravelPeriod;
  places: TravelPlaceSummary[];
  cover: TravelPhotoRef | null;
};

/**
 * The complete, sanitized trip produced by the publication projector. This is
 * also the owner preview contract: it contains public photo metadata, never a
 * private storage key or mutable draft-only field.
 */
export type TravelProjectedTrip = TravelTripSummary & {
  photos: TravelPhotoRef[];
};

export type TravelTripPreview = {
  schemaVersion: "1.0";
  contentHash: string;
  projectedAt: string;
  trip: TravelProjectedTrip;
};

export type TravelCountrySummary = {
  code: string;
  name: string;
  tripCount: number;
  regionCount: number;
  placeCount: number;
  photoCount: number;
};

export type TravelAtlasSnapshot = {
  schemaVersion: "1.0";
  contentHash: string;
  publishedAt: string;
  counts: {
    trips: number;
    countries: number;
    regions: number;
    places: number;
    photos: number;
  };
  countries: TravelCountrySummary[];
  trips: TravelTripSummary[];
};

export type TravelTripDetail = TravelProjectedTrip & {
  pagination: {
    page: number;
    pageSize: 12 | 24 | 36;
    total: number;
    pages: number;
  };
};

export type TravelPhotoDraft = {
  id: string;
  tripId: string;
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
  previewSrc: string;
  revision: string;
};

export type TravelPlaceDraft = {
  id: string;
  tripId: string;
  label: string;
  countryCode: string;
  countryName?: string;
  admin1Code: string | null;
  admin1Name?: string | null;
  precision: TravelPlacePrecision;
  publicPoint: { lat: number; lng: number };
  sortOrder?: number;
  photoCount?: number;
  revision: string;
};

export type TravelTripDraft = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: TravelTripStatus;
  period: TravelPeriod;
  places: TravelPlaceDraft[];
  photos: TravelPhotoDraft[];
  publishedAt: string | null;
  revision: string;
};

export type TravelUploadTransaction = {
  id: string;
  tripId: string;
  tripRevision: string;
  uploadUrl: string;
  uploadToken: string;
  expiresAt: string;
  maxBytes: number;
  acceptedMediaTypes: readonly string[];
};

export type PublicTravelAtlasEnvelope =
  | { status: "ready"; atlas: TravelAtlasSnapshot }
  | { status: "unavailable"; message: string };

export type PublicTravelTripEnvelope =
  | { status: "ready"; trip: TravelTripDetail }
  | { status: "not_found"; message: string }
  | { status: "unavailable"; message: string };
