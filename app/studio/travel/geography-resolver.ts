import {
  loadTravelAdmin1Manifest,
  loadTravelGeographyManifest,
} from "@/components/play/travel/travel-geography";
import type {
  TravelAdmin1Region,
  TravelGeographyCountry,
  TravelGeographyManifest,
} from "@/components/play/travel/travel-geography";

export type TravelGeographySuggestion = {
  countryCode: string;
  countryName: string;
  admin1Code: string | null;
  admin1Name: string | null;
  source: "Natural Earth";
};

export type TravelGeographyResolver = {
  suggest(
    lat: number,
    lng: number,
    signal?: AbortSignal,
  ): Promise<TravelGeographySuggestion | null>;
};

type CountryIdSampler = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * Loads only checked-in, first-party Natural Earth derivatives. The ID texture
 * gives deterministic country lookup without an external geocoder or map tile.
 */
export async function loadTravelGeographyResolver(
  signal?: AbortSignal,
): Promise<TravelGeographyResolver | null> {
  const manifest = await loadTravelGeographyManifest(signal);
  if (!manifest) return null;
  const sampler = await loadCountryIdSampler(manifest, signal);
  if (!sampler) return null;

  return {
    async suggest(lat, lng, lookupSignal) {
      throwIfAborted(lookupSignal);
      const country = resolveCountry(manifest, sampler, lat, lng);
      if (!country) return null;

      const region = await resolveAdmin1(
        manifest,
        country,
        lat,
        lng,
        lookupSignal,
      );
      throwIfAborted(lookupSignal);

      return {
        countryCode: country.code,
        countryName: country.name,
        admin1Code: region?.code ?? null,
        admin1Name: region?.name ?? null,
        source: "Natural Earth",
      };
    },
  };
}

async function loadCountryIdSampler(
  manifest: TravelGeographyManifest,
  signal?: AbortSignal,
): Promise<CountryIdSampler | null> {
  try {
    const response = await fetch(manifest.idTexture.src, {
      cache: "force-cache",
      headers: { Accept: "image/png" },
      signal,
    });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    throwIfAborted(signal);
    const canvas = document.createElement("canvas");
    canvas.width = manifest.idTexture.width;
    canvas.height = manifest.idTexture.height;
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return {
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

function resolveCountry(
  manifest: TravelGeographyManifest,
  sampler: CountryIdSampler,
  lat: number,
  lng: number,
): TravelGeographyCountry | null {
  const [x, y] = countryTexturePixel(lat, lng, sampler.width, sampler.height);
  const countryId = sampler.pixels[(y * sampler.width + x) * 4] ?? 0;
  if (countryId === 0) return null;
  return manifest.countries.find(({ id }) => id === countryId) ?? null;
}

async function resolveAdmin1(
  manifest: TravelGeographyManifest,
  country: TravelGeographyCountry,
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<TravelAdmin1Region | null> {
  if (!country.admin1Url) return null;
  const admin1 = await loadTravelAdmin1Manifest(
    manifest,
    country.code,
    signal,
  );
  if (!admin1) return null;
  return (
    admin1.regions.find((region) => pointInRegion(lat, lng, region)) ?? null
  );
}

export function pointInTravelRegion(
  lat: number,
  lng: number,
  region: Pick<TravelAdmin1Region, "rings">,
): boolean {
  return pointInRegion(lat, lng, region);
}

function pointInRegion(
  lat: number,
  lng: number,
  region: Pick<TravelAdmin1Region, "rings">,
): boolean {
  // Natural Earth may supply outer rings, holes, and disjoint islands. Even-odd
  // containment across every ring handles those cases after dateline unwrapping.
  let contained = false;
  for (const ring of region.rings) {
    if (pointInRing(lat, lng, ring)) contained = !contained;
  }
  return contained;
}

function pointInRing(
  lat: number,
  lng: number,
  ring: Array<readonly [number, number]>,
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLat, rawCurrentLng] = ring[index];
    const [previousLat, rawPreviousLng] = ring[previous];
    const currentLng = unwrapLongitude(rawCurrentLng, lng);
    const previousLng = unwrapLongitude(rawPreviousLng, lng);

    if (pointOnSegment(lng, lat, previousLng, previousLat, currentLng, currentLat)) {
      return true;
    }
    const crossesLatitude = currentLat > lat !== previousLat > lat;
    if (!crossesLatitude) continue;
    const crossingLng =
      ((previousLng - currentLng) * (lat - currentLat)) /
        (previousLat - currentLat) +
      currentLng;
    if (lng < crossingLng) inside = !inside;
  }
  return inside;
}

function pointOnSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-8) return false;
  return (
    x >= Math.min(x1, x2) - 1e-8 &&
    x <= Math.max(x1, x2) + 1e-8 &&
    y >= Math.min(y1, y2) - 1e-8 &&
    y <= Math.max(y1, y2) + 1e-8
  );
}

function unwrapLongitude(value: number, reference: number): number {
  let next = value;
  while (next - reference > 180) next -= 360;
  while (next - reference < -180) next += 360;
  return next;
}

function countryTexturePixel(
  lat: number,
  lng: number,
  width: number,
  height: number,
): readonly [number, number] {
  const normalizedLng = ((lng + 180) % 360 + 360) % 360;
  const x = Math.min(width - 1, Math.floor((normalizedLng / 360) * width));
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const y = Math.min(
    height - 1,
    Math.floor(((90 - clampedLat) / 180) * height),
  );
  return [x, y];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
