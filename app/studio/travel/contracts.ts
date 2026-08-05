import type {
  TravelPlacePrecision,
  TravelTripStatus,
  TravelPhotoDraft as SharedTravelPhotoDraft,
  TravelPlaceDraft as SharedTravelPlaceDraft,
  TravelTripDraft as SharedTravelTripDraft,
  TravelUploadTransaction,
} from "@/types/travel";

export type TravelPublicPoint = { lat: number; lng: number };
export type StudioTravelTrip = SharedTravelTripDraft;
export type StudioTravelPlace = SharedTravelPlaceDraft;
export type StudioTravelPhoto = SharedTravelPhotoDraft;

export type TravelTripDraft = Pick<
  StudioTravelTrip,
  "title" | "summary" | "status" | "period"
>;

export type TravelPlaceDraft = {
  label: string;
  countryCode: string;
  countryName: string;
  admin1Code: string | null;
  admin1Name: string | null;
  precision: TravelPlacePrecision;
  publicPoint: TravelPublicPoint;
  sortOrder: number;
};

export type TravelPhotoPatch = Pick<
  StudioTravelPhoto,
  | "placeId"
  | "altText"
  | "caption"
  | "capturedAt"
  | "capturePrecision"
  | "width"
  | "height"
  | "tags"
  | "sortOrder"
  | "isCover"
>;

export type TravelPhotoMoveDirection = "earlier" | "later";

export type { TravelUploadTransaction };

export type TravelSafetyCheck =
  | "locations"
  | "altText"
  | "people"
  | "timing"
  | "wholeTrip";

export const TRAVEL_SAFETY_CHECKS: ReadonlyArray<{
  id: TravelSafetyCheck;
  label: string;
}> = [
  {
    id: "locations",
    label:
      "I reviewed every public pin and intentionally chose its approximate location.",
  },
  {
    id: "altText",
    label: "Every included photo has useful alt text.",
  },
  {
    id: "people",
    label:
      "The trip reveals no home address, sensitive location, or person who should remain private.",
  },
  {
    id: "timing",
    label:
      "The trip status and date precision are safe to publish at this time.",
  },
  {
    id: "wholeTrip",
    label:
      "I understand that publishing exposes every accepted photo in this trip together.",
  },
];

export const EMPTY_TRIP_DRAFT: TravelTripDraft = {
  title: "",
  summary: "",
  status: "completed",
  period: {
    start: "",
    end: null,
    precision: "month",
  },
};

export function isRestrictedTravelStatus(
  status: TravelTripStatus,
): boolean {
  return status === "planned" || status === "current";
}

export function quantizePublicCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function quoteRevision(revision: string): string {
  return `"${revision}"`;
}
