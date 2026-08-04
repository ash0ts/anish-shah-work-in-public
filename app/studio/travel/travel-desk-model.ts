import type {
  TravelProjectedTrip,
} from "@/types/travel";
import {
  isRestrictedTravelStatus,
  quantizePublicCoordinate,
  TRAVEL_SAFETY_CHECKS,
  type StudioTravelPlace,
  type StudioTravelTrip,
  type TravelPlaceDraft,
  type TravelSafetyCheck,
  type TravelTripDraft,
} from "./contracts";
import type { LocalPhotoCandidate } from "./photo-intake";

export const EMPTY_PLACE: TravelPlaceDraft = {
  label: "",
  countryCode: "",
  countryName: "",
  admin1Code: null,
  admin1Name: null,
  precision: "region",
  publicPoint: { lat: 0, lng: 0 },
  sortOrder: 0,
};

export function toTripDraft(trip: StudioTravelTrip): TravelTripDraft {
  return {
    title: trip.title,
    summary: trip.summary,
    status: trip.status,
    period: { ...trip.period },
  };
}

export function toPlaceDraft(place: StudioTravelPlace): TravelPlaceDraft {
  return {
    label: place.label,
    countryCode: place.countryCode,
    countryName: place.countryName ?? place.countryCode,
    admin1Code: place.admin1Code,
    admin1Name: place.admin1Name ?? place.admin1Code,
    precision: place.precision,
    publicPoint: { ...place.publicPoint },
    sortOrder: place.sortOrder ?? 0,
  };
}

export function normalizePlaceDraft(draft: TravelPlaceDraft): TravelPlaceDraft {
  return {
    label: draft.label.trim(),
    countryCode: draft.countryCode.trim().toUpperCase(),
    countryName: draft.countryName.trim(),
    admin1Code: draft.admin1Code?.trim().toUpperCase() || null,
    admin1Name: draft.admin1Name?.trim() || null,
    precision: draft.precision,
    publicPoint: {
      lat: quantizePublicCoordinate(draft.publicPoint.lat),
      lng: quantizePublicCoordinate(draft.publicPoint.lng),
    },
    sortOrder: draft.sortOrder,
  };
}

export function validateTripDraft(draft: TravelTripDraft): string | null {
  if (!draft.title.trim() || !draft.summary.trim() || !draft.period.start) {
    return "Add a title, summary, and start period before saving.";
  }
  if (isRestrictedTravelStatus(draft.status) && draft.period.precision === "day") {
    return "Planned and current trips cannot store day-level public dates.";
  }
  if (draft.period.end && draft.period.end < draft.period.start) {
    return "The end period must be on or after the start period.";
  }
  return null;
}

export function validatePlaceDraft(
  draft: TravelPlaceDraft,
  status: StudioTravelTrip["status"],
): string | null {
  if (!draft.label || !/^[A-Z]{2}$/.test(draft.countryCode) || !draft.countryName) {
    return "Add a place label, country name, and two-letter country code.";
  }
  if (!Number.isFinite(draft.publicPoint.lat) || Math.abs(draft.publicPoint.lat) > 90 || !Number.isFinite(draft.publicPoint.lng) || Math.abs(draft.publicPoint.lng) > 180) {
    return "Choose a valid approximate latitude and longitude.";
  }
  if (isRestrictedTravelStatus(status) && draft.precision === "city_approximate") {
    return "Planned and current trips may publish only country or region precision.";
  }
  return null;
}

export function publicationIssue(
  trip: StudioTravelTrip,
  checks: Set<TravelSafetyCheck>,
): string | null {
  if (!trip.title.trim() || !trip.summary.trim() || !trip.period.start) {
    return "Save complete trip details before publishing.";
  }
  if (trip.places.length === 0) return "Add at least one approved public place.";
  if (isRestrictedTravelStatus(trip.status)) {
    if (trip.period.precision === "day") return "Use month- or year-level timing for planned/current travel.";
    if (trip.places.some((place) => place.precision === "city_approximate")) return "Remove approximate-city pins from planned/current travel.";
    if (trip.photos.length > 0) return "Planned/current trips cannot publish while photos are attached.";
  } else if (trip.photos.some((photo) => !photo.altText.trim() || !photo.placeId)) {
    return "Every completed-trip photo needs a place and useful alt text.";
  }
  if (checks.size !== TRAVEL_SAFETY_CHECKS.length) return "Complete every safety check before publishing.";
  return null;
}

export function formatPeriod(
  trip: Pick<StudioTravelTrip | TravelProjectedTrip, "period">,
): string {
  return trip.period.end ? `${trip.period.start}–${trip.period.end}` : trip.period.start;
}

export function commonPlaceId(photos: LocalPhotoCandidate[]): string {
  const first = photos[0]?.placeId ?? "";
  return photos.every((photo) => photo.placeId === first) ? first : "";
}

export function placePhotoCount(trip: StudioTravelTrip, placeId: string): number {
  return trip.photos.filter((photo) => photo.placeId === placeId).length;
}

export function ownerPhotoPreviewSrc(photo: { id: string }): string {
  return `/api/studio/travel/photos/${encodeURIComponent(photo.id)}/preview`;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
