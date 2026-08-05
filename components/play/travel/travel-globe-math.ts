import { MathUtils, Quaternion, Vector3 } from "three";

export const TRAVEL_GLOBE_DRAG_THRESHOLD_PX = 8;
export const TRAVEL_GLOBE_COUNTRY_SURFACE_YAW = -Math.PI / 2;

function normalizedLongitude(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && value > 0 ? 180 : wrapped;
}

/** Longitude rendered by Three SphereGeometry texture U after surface yaw. */
export function travelGlobeSurfaceLongitudeFromTextureU(
  textureU: number,
): number {
  const sphereLongitude = textureU * 360 - 90;
  return normalizedLongitude(
    sphereLongitude + MathUtils.radToDeg(TRAVEL_GLOBE_COUNTRY_SURFACE_YAW),
  );
}

export function latLngToVector3(
  lat: number,
  lng: number,
  radius = 1,
): Vector3 {
  const latitude = MathUtils.degToRad(MathUtils.clamp(lat, -90, 90));
  const longitude = MathUtils.degToRad(lng);
  return new Vector3(
    radius * Math.cos(latitude) * Math.sin(longitude),
    radius * Math.sin(latitude),
    radius * Math.cos(latitude) * Math.cos(longitude),
  );
}

export function vector3ToLatLng(vector: Vector3): {
  lat: number;
  lng: number;
} {
  const normalized = vector.clone().normalize();
  return {
    lat: MathUtils.radToDeg(Math.asin(MathUtils.clamp(normalized.y, -1, 1))),
    lng: MathUtils.radToDeg(Math.atan2(normalized.x, normalized.z)),
  };
}

/** Orient an XY-plane marker so its +Z normal follows the globe surface. */
export function travelGlobeSurfaceQuaternion(
  lat: number,
  lng: number,
): Quaternion {
  return new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, 1),
    latLngToVector3(lat, lng).normalize(),
  );
}

export function crossedTravelGlobeDragThreshold(
  origin: readonly [number, number],
  current: readonly [number, number],
): boolean {
  return Math.hypot(current[0] - origin[0], current[1] - origin[1]) >
    TRAVEL_GLOBE_DRAG_THRESHOLD_PX;
}

export function resolveTravelGlobeGesture(
  alreadyDragged: boolean,
  origin: readonly [number, number],
  current: readonly [number, number],
): { dragged: boolean; suppressSelection: boolean } {
  const dragged =
    alreadyDragged || crossedTravelGlobeDragThreshold(origin, current);
  return { dragged, suppressSelection: dragged };
}

export function clampTravelGlobeTilt(value: number): number {
  return MathUtils.clamp(value, -1.15, 1.15);
}

export function countryTexturePixel(
  lat: number,
  lng: number,
  width: number,
  height: number,
): readonly [number, number] {
  const normalizedLng = ((lng + 180) % 360 + 360) % 360;
  const x = Math.min(width - 1, Math.floor((normalizedLng / 360) * width));
  const y = Math.min(
    height - 1,
    Math.floor(((90 - MathUtils.clamp(lat, -90, 90)) / 180) * height),
  );
  return [x, y];
}

export function travelRegionTripCounts(
  trips: ReadonlyArray<{
    places: ReadonlyArray<{
      countryCode: string;
      admin1Code: string | null;
    }>;
  }>,
  countryCode: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const trip of trips) {
    const regions = new Set(
      trip.places
        .filter((place) => place.countryCode === countryCode)
        .flatMap((place) => (place.admin1Code ? [place.admin1Code] : [])),
    );
    for (const region of regions) {
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
  }
  return counts;
}
