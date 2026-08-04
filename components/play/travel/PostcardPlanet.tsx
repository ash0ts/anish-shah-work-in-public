"use client";

import Link from "next/link";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PublicTravelAtlasEnvelope,
  TravelAtlasSnapshot,
  TravelPlaceSummary,
  TravelTripSummary,
} from "@/types/travel";
import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
import type { TravelPreviewScenario } from "@/lib/server/travel/preview";
import {
  loadTravelAdmin1Manifest,
  loadTravelGeographyManifest,
  type TravelAdmin1Manifest,
  type TravelGeographyManifest,
} from "./travel-geography";
import type { TravelGlobeCapability } from "./travel-globe-capability";
import { TravelGlobeGate } from "./TravelGlobeGate";
import { travelPhotoSrcSet, travelPhotoUrl } from "./travel-media";
import styles from "./PostcardPlanet.module.css";

const LazyTravelGlobeStage = lazy(() =>
  import("./TravelGlobeStage").then((module) => ({
    default: module.TravelGlobeStage,
  })),
);

function periodLabel(trip: TravelTripSummary): string {
  if (trip.period.start === trip.period.end || !trip.period.end) {
    return trip.period.start;
  }
  return `${trip.period.start}–${trip.period.end}`;
}

function statusLabel(status: TravelTripSummary["status"]): string {
  if (status === "planned") return "Planned signal";
  if (status === "current") return "Transmitting now";
  return "Travel log";
}

function uniquePlaces(atlas: TravelAtlasSnapshot): TravelPlaceSummary[] {
  const byId = new Map<string, TravelPlaceSummary>();
  for (const trip of atlas.trips) {
    for (const place of trip.places) byId.set(place.id, place);
  }
  return [...byId.values()];
}

function tripContainsPlace(trip: TravelTripSummary, placeId: string | null) {
  return placeId ? trip.places.some(({ id }) => id === placeId) : false;
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

function TravelTripCard({
  trip,
  previewFixture,
}: {
  trip: TravelTripSummary;
  previewFixture?: TravelPreviewScenario;
}) {
  return (
    <article className={styles.tripCard} data-travel-trip={trip.slug}>
      {trip.cover ? (
        <picture>
          <img
            alt={trip.cover.alt}
            decoding="async"
            height={trip.cover.height}
            loading="lazy"
            sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 34vw"
            src={travelPhotoUrl(trip.cover, "960")}
            srcSet={travelPhotoSrcSet(trip.cover)}
            width={trip.cover.width}
          />
        </picture>
      ) : (
        <div aria-hidden="true" className={styles.tripFallback}>
          <span>{trip.places[0]?.countryCode ?? "WORLD"}</span>
          <i />
          <i />
        </div>
      )}
      <div>
        <p>
          <span>{statusLabel(trip.status)}</span>
          <time dateTime={trip.period.start}>{periodLabel(trip)}</time>
        </p>
        <h3>{trip.title}</h3>
        <p>{trip.summary}</p>
        <ul aria-label={`${trip.title} places`}>
          {trip.places.slice(0, 4).map((place) => (
            <li key={place.id}>{place.label}</li>
          ))}
        </ul>
        <Link href={tripHref(trip.slug, previewFixture)} prefetch={false}>
          Open trip log <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}

function AtlasUnavailable({ message }: { message: string }) {
  return (
    <section className={styles.unavailable} data-travel-atlas-unavailable>
      <p>Receiver status · No public transmission</p>
      <h2>The atlas is folded away.</h2>
      <span>{message}</span>
      <Link href="/play">Choose another object</Link>
    </section>
  );
}

export function PostcardPlanet({
  initialState,
  previewFixture,
}: {
  initialState: PublicTravelAtlasEnvelope;
  previewFixture?: TravelPreviewScenario;
}) {
  const [geography, setGeography] = useState<TravelGeographyManifest | null>(null);
  const [loadedAdmin1, setLoadedAdmin1] =
    useState<TravelAdmin1Manifest | null>(null);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(0.08);
  const [globeReady, setGlobeReady] = useState(false);
  const [globeFailed, setGlobeFailed] = useState(false);
  const [globeInteractive, setGlobeInteractive] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const atlasBackRef = useRef<HTMLButtonElement>(null);
  const countrySearchRef = useRef<HTMLInputElement>(null);
  const { playCue } = useExperienceAudio();

  const atlas = initialState.status === "ready" ? initialState.atlas : null;
  const admin1 =
    loadedAdmin1?.countryCode === selectedCountryCode ? loadedAdmin1 : null;
  const places = useMemo(() => (atlas ? uniquePlaces(atlas) : []), [atlas]);
  const countryDirectory = useMemo(() => {
    if (!atlas) return [];
    if (!geography) return atlas.countries;
    const published = new Map(
      atlas.countries.map((country) => [country.code, country]),
    );
    return geography.countries.map((country) =>
      published.get(country.code) ?? {
        code: country.code,
        name: country.name,
        tripCount: 0,
        regionCount: 0,
        placeCount: 0,
        photoCount: 0,
      },
    );
  }, [atlas, geography]);

  useEffect(() => {
    const controller = new AbortController();
    loadTravelGeographyManifest(controller.signal)
      .then((result) => setGeography(result))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!geography || !selectedCountryCode) return;
    const controller = new AbortController();
    loadTravelAdmin1Manifest(
      geography,
      selectedCountryCode,
      controller.signal,
    )
      .then((result) => setLoadedAdmin1(result))
      .catch(() => undefined);
    return () => controller.abort();
  }, [geography, selectedCountryCode]);

  const selectCountry = useCallback(
    (code: string | null, restoreDirectoryFocus = false) => {
      setSelectedCountryCode(code);
      setSelectedRegionCode(null);
      setSelectedPlaceId(null);
      if (!code) {
        setAnnouncement("World view selected.");
        if (restoreDirectoryFocus) {
          requestAnimationFrame(() => countrySearchRef.current?.focus());
        }
        return;
      }
      const name =
        geography?.countries.find((country) => country.code === code)?.name ??
        atlas?.countries.find((country) => country.code === code)?.name ??
        code;
      playCue("travel-country");
      setAnnouncement(`${name} selected.`);
      if (restoreDirectoryFocus) {
        requestAnimationFrame(() => atlasBackRef.current?.focus());
      }
    },
    [atlas?.countries, geography?.countries, playCue],
  );

  const selectPlace = useCallback(
    (placeId: string) => {
      const place = places.find(({ id }) => id === placeId);
      if (!place) return;
      setSelectedCountryCode(place.countryCode);
      setSelectedRegionCode(place.admin1Code);
      setSelectedPlaceId(place.id);
      setZoom(0.82);
      playCue("travel-pin");
      setAnnouncement(`${place.label} selected. Related trips are shown below.`);
    },
    [places, playCue],
  );

  const handleGlobeCapability = useCallback(
    (capability: TravelGlobeCapability) => {
      setGlobeInteractive(capability.eligible);
      if (!capability.eligible) setGlobeReady(false);
    },
    [],
  );

  const handleGlobeFailure = useCallback(() => {
    setGlobeFailed(true);
    setGlobeInteractive(false);
    setGlobeReady(false);
    setAnnouncement(
      "The 3D globe stopped. The atlas directory remains available.",
    );
  }, []);

  if (initialState.status === "unavailable") {
    return <AtlasUnavailable message={initialState.message} />;
  }
  const readyAtlas = initialState.atlas;

  const countryName = selectedCountryCode
    ? geography?.countries.find(({ code }) => code === selectedCountryCode)?.name ??
      readyAtlas.countries.find(({ code }) => code === selectedCountryCode)?.name ??
      selectedCountryCode
    : "World";
  const selectedCountryPlaces = selectedCountryCode
    ? places.filter(({ countryCode }) => countryCode === selectedCountryCode)
    : places;
  const regions = [...new Map(
    selectedCountryPlaces
      .filter((place) => place.admin1Code)
      .map((place) => [place.admin1Code as string, place.admin1Name ?? place.admin1Code as string]),
  )].sort((left, right) => left[1].localeCompare(right[1]));
  const visiblePlaces = selectedRegionCode
    ? selectedCountryPlaces.filter(({ admin1Code }) => admin1Code === selectedRegionCode)
    : selectedCountryPlaces;
  const selectedTrips = selectedPlaceId
    ? readyAtlas.trips.filter((trip) => tripContainsPlace(trip, selectedPlaceId))
    : selectedCountryCode
      ? readyAtlas.trips.filter((trip) =>
          trip.places.some(({ countryCode }) => countryCode === selectedCountryCode),
        )
      : readyAtlas.trips;
  const searchResults = countryDirectory.filter(({ name, code }) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || name.toLocaleLowerCase().includes(needle) || code.toLocaleLowerCase().includes(needle);
  });
  const selectedPlace = places.find(({ id }) => id === selectedPlaceId) ?? null;
  const stepBack = () => {
    if (selectedPlaceId) {
      setSelectedPlaceId(null);
      setAnnouncement(
        selectedRegionCode
          ? `${regions.find(([code]) => code === selectedRegionCode)?.[1] ?? "Region"} selected.`
          : `${countryName} selected.`,
      );
      return;
    }
    if (selectedRegionCode) {
      setSelectedRegionCode(null);
      setAnnouncement(`${countryName} selected.`);
      return;
    }
    if (selectedCountryCode) selectCountry(null, true);
  };

  return (
    <div className={styles.atlas} data-postcard-planet>
      <p aria-live="polite" className={styles.srOnly} role="status">
        {announcement}
      </p>

      <section className={styles.console} aria-labelledby="travel-map-title">
        <header className={styles.consoleHeader}>
          <div>
            <p>Receiver 07 · Public travel signal</p>
            <h2 id="travel-map-title">{countryName}</h2>
          </div>
          <dl>
            <div><dt>Trips</dt><dd>{readyAtlas.counts.trips}</dd></div>
            <div><dt>Countries</dt><dd>{readyAtlas.counts.countries}</dd></div>
            <div><dt>Photos</dt><dd>{readyAtlas.counts.photos}</dd></div>
          </dl>
        </header>

        <div className={styles.mapLayout}>
          <div className={styles.globePanel}>
            <div
              className={styles.globeFrame}
              data-globe-ready={globeReady ? "true" : undefined}
            >
              <TravelGlobeGate
                fallback={
                  <div className={styles.staticMap} data-travel-static-atlas>
                    <span>Semantic atlas active</span>
                    <i aria-hidden="true" />
                    <p>Choose a country, region, or place from the directory.</p>
                  </div>
                }
                onCapabilityChange={handleGlobeCapability}
              >
                {geography && !globeFailed ? (
                  <Suspense
                    fallback={
                      <div className={styles.staticMap} role="status">
                        <span>Building globe</span>
                        <i aria-hidden="true" />
                        <p>The complete atlas directory is already available.</p>
                      </div>
                    }
                  >
                    <LazyTravelGlobeStage
                      admin1={admin1}
                      atlas={readyAtlas}
                      geography={geography}
                      onContextLoss={handleGlobeFailure}
                      onReady={() => setGlobeReady(true)}
                      onSelectCountry={(code) => selectCountry(code)}
                      onSelectPlace={selectPlace}
                      onZoomChange={setZoom}
                      reducedMotion={false}
                      selectedCountryCode={selectedCountryCode}
                      selectedPlaceId={selectedPlaceId}
                      selectedRegionCode={selectedRegionCode}
                      zoom={zoom}
                    />
                  </Suspense>
                ) : (
                  <div className={styles.staticMap} data-travel-static-atlas>
                    <span>{geography ? "Globe unavailable" : "Loading map index"}</span>
                    <i aria-hidden="true" />
                    <p>Choose a country, region, or place from the directory.</p>
                  </div>
                )}
              </TravelGlobeGate>
              {globeInteractive && geography && !globeFailed ? (
                <div className={styles.zoomControls} aria-label="Globe zoom" role="group">
                <button
                  aria-label="Zoom globe out"
                  disabled={zoom <= 0}
                  onClick={() => setZoom((value) => Math.max(0, value - 0.2))}
                  type="button"
                >
                  −
                </button>
                <button
                  aria-label="Zoom globe in"
                  disabled={zoom >= 1}
                  onClick={() => setZoom((value) => Math.min(1, value + 0.2))}
                  type="button"
                >
                  +
                </button>
                <button
                  aria-label="Reset globe view"
                  onClick={() => {
                    setZoom(0.08);
                    selectCountry(null);
                  }}
                  type="button"
                >
                  ↺
                </button>
              </div>
              ) : null}
            </div>
            <div className={styles.legend} aria-label="Trip count color legend">
              {[
                ["0", "Unvisited"],
                ["1", "One trip"],
                ["2", "Two trips"],
                ["3+", "Three or more trips"],
              ].map(([value, label]) => (
                <span data-count={value} key={value}><i />{label}</span>
              ))}
            </div>
            <p className={styles.globeHint}>
              {globeInteractive && geography && !globeFailed
                ? "Drag to turn · Pinch or use the zoom controls · Country fill and region lines show published trips"
                : "Use the country, region, and place directory · Counts describe published trips"}
            </p>
            <p className={styles.mapCredit}>
              Map boundaries from{" "}
              <a
                href="https://www.naturalearthdata.com/about/terms-of-use/"
                rel="noreferrer"
                target="_blank"
              >
                Natural Earth
              </a>
              , public domain.
            </p>
          </div>

          <aside className={styles.directory} aria-label="Travel atlas directory">
            <div className={styles.breadcrumbs} aria-label="Atlas level">
              <button
                className={styles.backButton}
                data-travel-atlas-back
                disabled={!selectedCountryCode && !selectedRegionCode && !selectedPlaceId}
                onClick={stepBack}
                ref={atlasBackRef}
                type="button"
              >
                <span aria-hidden="true">←</span> Back
              </button>
              <button onClick={() => selectCountry(null, true)} type="button">World</button>
              {selectedCountryCode ? <span aria-hidden="true">/</span> : null}
              {selectedCountryCode ? (
                <button onClick={() => {
                  setSelectedRegionCode(null);
                  setSelectedPlaceId(null);
                }} type="button">{countryName}</button>
              ) : null}
              {selectedRegionCode ? <span aria-hidden="true">/</span> : null}
              {selectedRegionCode ? <b>{regions.find(([code]) => code === selectedRegionCode)?.[1]}</b> : null}
            </div>

            {!selectedCountryCode ? (
              <div className={styles.countryIndex}>
                <label htmlFor="travel-country-search">Find a country</label>
                <input
                  autoComplete="off"
                  aria-controls="travel-country-results"
                  id="travel-country-search"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search the public atlas"
                  ref={countrySearchRef}
                  type="search"
                  value={query}
                />
                <p aria-live="polite" className={styles.searchStatus} role="status">
                  {searchResults.length} {searchResults.length === 1 ? "country" : "countries"}
                </p>
                {searchResults.length ? (
                  <ol id="travel-country-results">
                    {searchResults.map((country) => (
                      <li key={country.code}>
                        <button
                          data-travel-country={country.code}
                          onClick={() => selectCountry(country.code, true)}
                          type="button"
                        >
                          <span>{country.code}</span>
                          <strong>{country.name}</strong>
                          <small>{country.tripCount} {country.tripCount === 1 ? "trip" : "trips"}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.noSearchResults} id="travel-country-results">
                    No countries match that search.
                  </p>
                )}
              </div>
            ) : (
              <div className={styles.placeIndex}>
                {regions.length ? (
                  <nav aria-label={`${countryName} regions`}>
                    <button
                      aria-pressed={!selectedRegionCode}
                      onClick={() => {
                        setSelectedRegionCode(null);
                        setSelectedPlaceId(null);
                      }}
                      type="button"
                    >
                      All regions
                    </button>
                    {regions.map(([code, name]) => (
                      <button
                        aria-pressed={selectedRegionCode === code}
                        data-travel-region={code}
                        key={code}
                        onClick={() => {
                          setSelectedRegionCode(code);
                          setSelectedPlaceId(null);
                          setAnnouncement(`${name} selected.`);
                        }}
                        type="button"
                      >
                        {name}
                      </button>
                    ))}
                  </nav>
                ) : null}
                {visiblePlaces.length ? (
                  <ol>
                    {visiblePlaces.map((place) => (
                      <li key={place.id}>
                        <button
                          aria-pressed={selectedPlaceId === place.id}
                          data-travel-place={place.id}
                          onClick={() => selectPlace(place.id)}
                          type="button"
                        >
                          <span>{place.precision === "city_approximate" ? "Approximate city" : place.precision}</span>
                          <strong>{place.label}</strong>
                          <small>{place.photoCount} {place.photoCount === 1 ? "photo" : "photos"}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.noPlaces}>No published place is pinned here yet.</p>
                )}
              </div>
            )}
            {selectedPlace ? (
              <section
                aria-atomic="true"
                aria-labelledby="travel-place-inspector-title"
                aria-live="polite"
                className={styles.placeInspector}
                data-travel-place-inspector={selectedPlace.id}
              >
                <p>
                  {selectedPlace.precision === "city_approximate"
                    ? "Approximate public city pin"
                    : `${selectedPlace.precision} pin`}
                </p>
                <h3 id="travel-place-inspector-title">{selectedPlace.label}</h3>
                <dl>
                  <div>
                    <dt>Photos</dt>
                    <dd>{selectedPlace.photoCount}</dd>
                  </div>
                  <div>
                    <dt>Trips</dt>
                    <dd>{selectedTrips.length}</dd>
                  </div>
                </dl>
                <ul aria-label={`Trips connected to ${selectedPlace.label}`}>
                  {selectedTrips.map((trip) => (
                    <li key={trip.id}>
                      <Link
                        href={tripHref(trip.slug, previewFixture)}
                        prefetch={false}
                      >
                        {trip.title} <span aria-hidden="true">↗</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </section>

      <section className={styles.tripIndex} aria-labelledby="travel-trip-title">
        <header>
          <p>{selectedPlace ? `Pinned location · ${selectedPlace.label}` : selectedCountryCode ? `Country log · ${countryName}` : "Complete travel log"}</p>
          <h2 id="travel-trip-title">{selectedTrips.length ? `${selectedTrips.length} ${selectedTrips.length === 1 ? "story" : "stories"} in range` : "No published stories here yet"}</h2>
        </header>
        {selectedTrips.length ? (
          <div className={styles.tripGrid}>
            {selectedTrips.map((trip) => (
              <TravelTripCard
                key={trip.id}
                previewFixture={previewFixture}
                trip={trip}
              />
            ))}
          </div>
        ) : (
          <button className={styles.worldReset} onClick={() => selectCountry(null)} type="button">
            Return to the world view
          </button>
        )}
      </section>
    </div>
  );
}
