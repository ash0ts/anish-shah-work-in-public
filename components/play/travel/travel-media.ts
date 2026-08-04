import type { TravelPhotoRef, TravelPhotoVariant } from "@/types/travel";

export function travelPhotoUrl(
  photo: TravelPhotoRef,
  variant: TravelPhotoVariant,
): `/api/travel-media/${string}/${TravelPhotoVariant}/${string}` {
  return `/api/travel-media/${encodeURIComponent(photo.id)}/${variant}/${photo.mediaDigest}`;
}

export function travelPhotoSrcSet(photo: TravelPhotoRef): string {
  return [
    `${travelPhotoUrl(photo, "480")} 480w`,
    `${travelPhotoUrl(photo, "960")} 960w`,
    `${travelPhotoUrl(photo, "1920")} 1920w`,
  ].join(", ");
}
