import Link from "next/link";

import type {
  TravelAtlasSnapshot,
  TravelPlaceSummary,
  TravelTripSummary,
} from "@/types/travel";
import type { TravelPreviewScenario } from "@/lib/server/travel/preview";
import styles from "./TravelNoScriptAtlas.module.css";

function fragmentPart(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function uniquePlaces(
  trips: TravelTripSummary[],
  countryCode: string,
): TravelPlaceSummary[] {
  const places = new Map<string, TravelPlaceSummary>();
  for (const trip of trips) {
    for (const place of trip.places) {
      if (place.countryCode === countryCode) places.set(place.id, place);
    }
  }
  return [...places.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function tripsForPlace(
  trips: TravelTripSummary[],
  placeId: string,
): TravelTripSummary[] {
  return trips.filter((trip) =>
    trip.places.some((place) => place.id === placeId),
  );
}

function tripHref(
  slug: string,
  previewFixture: TravelPreviewScenario | undefined,
): string {
  const pathname = `/play/travel/trips/${slug}`;
  return previewFixture
    ? `${pathname}?fixture=${encodeURIComponent(previewFixture)}`
    : pathname;
}

export function TravelNoScriptAtlas({
  atlas,
  previewFixture,
}: {
  atlas: TravelAtlasSnapshot;
  previewFixture?: TravelPreviewScenario;
}) {
  return (
    <noscript>
      <section
        aria-labelledby="travel-static-atlas-title"
        className={styles.atlas}
        data-travel-noscript-atlas
        id="travel-static-atlas"
      >
        <header>
          <p>Text atlas · No JavaScript required</p>
          <h2 id="travel-static-atlas-title">Published travel directory</h2>
          <span>
            Follow a country to its regions and places, then open any trip log.
          </span>
        </header>

        <nav aria-label="Published travel countries" id="travel-static-country-index">
          <ul>
            {atlas.countries.map((country) => (
              <li key={country.code}>
                <a href={`#travel-static-country-${fragmentPart(country.code)}`}>
                  {country.name} · {country.tripCount} {country.tripCount === 1 ? "trip" : "trips"}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.countries}>
          {atlas.countries.map((country) => {
            const places = uniquePlaces(atlas.trips, country.code);
            const regions = new Map<string, TravelPlaceSummary[]>();
            for (const place of places) {
              const key = place.admin1Code ?? `country-${country.code}`;
              const current = regions.get(key) ?? [];
              current.push(place);
              regions.set(key, current);
            }
            return (
              <section
                aria-labelledby={`travel-static-country-title-${fragmentPart(country.code)}`}
                id={`travel-static-country-${fragmentPart(country.code)}`}
                key={country.code}
              >
                <h3 id={`travel-static-country-title-${fragmentPart(country.code)}`}>
                  {country.name}
                </h3>
                <p>
                  {country.regionCount} {country.regionCount === 1 ? "region" : "regions"} · {country.placeCount} {country.placeCount === 1 ? "place" : "places"} · {country.photoCount} {country.photoCount === 1 ? "photo" : "photos"}
                </p>
                {regions.size ? (
                  [...regions.entries()].map(([regionCode, regionPlaces]) => {
                    const regionName =
                      regionPlaces[0]?.admin1Name ?? `${country.name} countrywide`;
                    const regionId = `travel-static-region-${fragmentPart(regionCode)}`;
                    return (
                      <section aria-labelledby={`${regionId}-title`} id={regionId} key={regionCode}>
                        <h4 id={`${regionId}-title`}>{regionName}</h4>
                        <ul>
                          {regionPlaces.map((place) => (
                            <li id={`travel-static-place-${fragmentPart(place.id)}`} key={place.id}>
                              <strong>{place.label}</strong>
                              <span>
                                {place.precision === "city_approximate"
                                  ? "Approximate city pin"
                                  : `${place.precision} pin`}
                              </span>
                              <ul aria-label={`Trips connected to ${place.label}`}>
                                {tripsForPlace(atlas.trips, place.id).map((trip) => (
                                  <li key={trip.id}>
                                    <Link
                                      href={tripHref(trip.slug, previewFixture)}
                                      prefetch={false}
                                    >
                                      {trip.title}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })
                ) : (
                  <p>No published place is pinned here yet.</p>
                )}
                <a href="#travel-static-country-index">Back to countries</a>
              </section>
            );
          })}
        </div>
      </section>
    </noscript>
  );
}
