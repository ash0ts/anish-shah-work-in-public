export type TravelGeographyCountry = {
  id: number;
  code: string;
  name: string;
  centroid: readonly [number, number];
  bounds: readonly [
    readonly [number, number],
    readonly [number, number],
  ];
  admin1Url: string | null;
};

export type TravelGeographyManifest = {
  schemaVersion: "1.0";
  source: "Natural Earth";
  idTexture: {
    src: string;
    width: number;
    height: number;
  };
  countries: TravelGeographyCountry[];
};

export type TravelAdmin1Region = {
  code: string;
  name: string;
  centroid: readonly [number, number];
  rings: Array<Array<readonly [number, number]>>;
};

export type TravelAdmin1Manifest = {
  schemaVersion: "1.0";
  countryCode: string;
  regions: TravelAdmin1Region[];
};

const ASSET_ROOT = "/assets/travel/geography/";
const MANIFEST_URL = `${ASSET_ROOT}manifest.v1.json`;

function isHttpPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(ASSET_ROOT) &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}

export function parseTravelGeographyManifest(
  value: unknown,
  countriesValue?: unknown,
): TravelGeographyManifest | null {
  if (!value || typeof value !== "object" || !countriesValue || typeof countriesValue !== "object") {
    return null;
  }
  const manifest = value as {
    schemaVersion?: unknown;
    source?: { name?: unknown };
    texture?: { path?: unknown; width?: unknown; height?: unknown };
    countries?: { path?: unknown };
    admin1?: Array<{ iso2?: unknown; path?: unknown }>;
  };
  const countryFile = countriesValue as {
    schemaVersion?: unknown;
    countries?: Array<{
      id?: unknown;
      iso2?: unknown;
      name?: unknown;
      centroid?: unknown;
      bounds?: unknown;
    }>;
  };
  if (
    manifest.schemaVersion !== "1.0" ||
    manifest.source?.name !== "Natural Earth" ||
    !manifest.texture ||
    typeof manifest.texture.path !== "string" ||
    !Number.isInteger(manifest.texture.width) ||
    !Number.isInteger(manifest.texture.height) ||
    !manifest.countries ||
    typeof manifest.countries.path !== "string" ||
    countryFile.schemaVersion !== "1.0" ||
    !Array.isArray(countryFile.countries) ||
    !Array.isArray(manifest.admin1)
  ) {
    return null;
  }
  const textureSrc = `${ASSET_ROOT}${manifest.texture.path}`;
  const countriesSrc = `${ASSET_ROOT}${manifest.countries.path}`;
  if (!isHttpPath(textureSrc) || !isHttpPath(countriesSrc)) return null;
  const admin1ByCountry = new Map<string, string>();
  for (const entry of manifest.admin1) {
    if (
      typeof entry.iso2 !== "string" ||
      !/^[A-Z]{2}$/.test(entry.iso2) ||
      typeof entry.path !== "string"
    ) {
      return null;
    }
    const url = `${ASSET_ROOT}${entry.path}`;
    if (!isHttpPath(url)) return null;
    admin1ByCountry.set(entry.iso2, url);
  }
  const seenCodes = new Set<string>();
  const seenIds = new Set<number>();
  const countries: TravelGeographyCountry[] = [];
  for (const country of countryFile.countries) {
    const centroid = country.centroid;
    const bounds = country.bounds;
    if (
      !Number.isInteger(country.id) ||
      (country.id as number) < 1 ||
      (country.id as number) > 255 ||
      typeof country.iso2 !== "string" ||
      !/^[A-Z]{2}$/.test(country.iso2) ||
      typeof country.name !== "string" ||
      !Array.isArray(centroid) ||
      centroid.length !== 2 ||
      !centroid.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)) ||
      !Array.isArray(bounds) ||
      bounds.length !== 2 ||
      !bounds.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)),
      ) ||
      seenCodes.has(country.iso2) ||
      seenIds.has(country.id as number)
    ) {
      return null;
    }
    seenCodes.add(country.iso2);
    seenIds.add(country.id as number);
    countries.push({
      id: country.id as number,
      code: country.iso2,
      name: country.name,
      centroid: [centroid[1] as number, centroid[0] as number],
      bounds: [
        [(bounds[0] as number[])[1], (bounds[0] as number[])[0]],
        [(bounds[1] as number[])[1], (bounds[1] as number[])[0]],
      ],
      admin1Url: admin1ByCountry.get(country.iso2) ?? null,
    });
  }
  return {
    schemaVersion: "1.0",
    source: "Natural Earth",
    idTexture: {
      src: textureSrc,
      width: manifest.texture.width as number,
      height: manifest.texture.height as number,
    },
    countries,
  };
}

export async function loadTravelGeographyManifest(
  signal?: AbortSignal,
): Promise<TravelGeographyManifest | null> {
  try {
    const response = await fetch(MANIFEST_URL, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    const manifest = (await response.json()) as {
      countries?: { path?: unknown };
    };
    if (typeof manifest.countries?.path !== "string") return null;
    const countriesUrl = `${ASSET_ROOT}${manifest.countries.path}`;
    if (!isHttpPath(countriesUrl)) return null;
    const countriesResponse = await fetch(countriesUrl, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!countriesResponse.ok) return null;
    return parseTravelGeographyManifest(manifest, await countriesResponse.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function parseTravelAdmin1Manifest(
  value: unknown,
  countryCode: string,
): TravelAdmin1Manifest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    type?: unknown;
    features?: Array<{
      properties?: { code?: unknown; name?: unknown; centroid?: unknown };
      geometry?: { type?: unknown; coordinates?: unknown };
    }>;
  };
  if (candidate.type !== "FeatureCollection" || !Array.isArray(candidate.features)) {
    return null;
  }
  const regions: TravelAdmin1Region[] = [];
  for (const feature of candidate.features) {
    const properties = feature.properties;
    const geometry = feature.geometry;
    if (
      typeof properties?.code !== "string" ||
      typeof properties.name !== "string" ||
      !Array.isArray(properties.centroid) ||
      properties.centroid.length !== 2 ||
      !properties.centroid.every(
        (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
      ) ||
      !geometry ||
      (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") ||
      !Array.isArray(geometry.coordinates)
    ) {
      return null;
    }
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;
    const rings: Array<Array<readonly [number, number]>> = [];
    for (const polygon of polygons as unknown[][]) {
      if (!Array.isArray(polygon)) return null;
      for (const rawRing of polygon as unknown[]) {
        if (!Array.isArray(rawRing)) return null;
        const ring: Array<readonly [number, number]> = [];
        for (const coordinate of rawRing as unknown[]) {
          if (
            !Array.isArray(coordinate) ||
            coordinate.length < 2 ||
            typeof coordinate[0] !== "number" ||
            typeof coordinate[1] !== "number" ||
            !Number.isFinite(coordinate[0]) ||
            !Number.isFinite(coordinate[1])
          ) {
            return null;
          }
          ring.push([coordinate[1], coordinate[0]]);
        }
        rings.push(ring);
      }
    }
    regions.push({
      code: properties.code,
      name: properties.name,
      centroid: [properties.centroid[1] as number, properties.centroid[0] as number],
      rings,
    });
  }
  return { schemaVersion: "1.0", countryCode, regions };
}

export async function loadTravelAdmin1Manifest(
  manifest: TravelGeographyManifest,
  countryCode: string,
  signal?: AbortSignal,
): Promise<TravelAdmin1Manifest | null> {
  const country = manifest.countries.find(({ code }) => code === countryCode);
  if (!country?.admin1Url) return null;
  try {
    const response = await fetch(country.admin1Url, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    return parseTravelAdmin1Manifest(await response.json(), countryCode);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
