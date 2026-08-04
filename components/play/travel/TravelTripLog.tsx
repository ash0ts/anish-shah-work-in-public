import Link from "next/link";

import type { TravelTripDetail } from "@/types/travel";
import type { TravelPreviewScenario } from "@/lib/server/travel/preview";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";
import { ScreenNavigation } from "../room-screens/ScreenNavigation";
import { travelPhotoSrcSet, travelPhotoUrl } from "./travel-media";
import styles from "./TravelTripLog.module.css";

function periodLabel(trip: TravelTripDetail): string {
  return trip.period.end && trip.period.end !== trip.period.start
    ? `${trip.period.start}–${trip.period.end}`
    : trip.period.start;
}

const PAGE_SIZES = [12, 24, 36] as const;

function pageSizeHref(
  trip: TravelTripDetail,
  pageSize: 12 | 24 | 36,
  previewFixture: TravelPreviewScenario | undefined,
): string {
  const firstVisibleIndex =
    (trip.pagination.page - 1) * trip.pagination.pageSize;
  const requestedPage = Math.floor(firstVisibleIndex / pageSize) + 1;
  const maximumPage = Math.max(1, Math.ceil(trip.pagination.total / pageSize));
  const page = Math.min(requestedPage, maximumPage);
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (page > 1) query.set("page", String(page));
  if (previewFixture) query.set("fixture", previewFixture);
  return `/play/travel/trips/${trip.slug}?${query.toString()}`;
}

function paginationHref(
  trip: TravelTripDetail,
  page: number,
  previewFixture: TravelPreviewScenario | undefined,
): string {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(trip.pagination.pageSize),
  });
  if (previewFixture) query.set("fixture", previewFixture);
  return `/play/travel/trips/${trip.slug}?${query.toString()}`;
}

export function TravelTripLog({
  trip,
  previewFixture,
}: {
  trip: TravelTripDetail;
  previewFixture?: TravelPreviewScenario;
}) {
  return (
    <main className={styles.page} data-room-screen data-travel-trip-log id="main" tabIndex={-1}>
      <ScreenNavigation object={ROOM_OBJECT_BY_ID.travel} />
      <header className={styles.header}>
        <p>
          <span>{trip.status === "completed" ? "Travel log" : `${trip.status} signal`}</span>
          <time dateTime={trip.period.start}>{periodLabel(trip)}</time>
        </p>
        <h1>{trip.title}</h1>
        <div>
          <p>{trip.summary}</p>
          <ul aria-label="Places in this trip">
            {trip.places.map((place) => (
              <li key={place.id}>
                {place.label}
                <small>
                  {place.precision === "city_approximate"
                    ? "approximate city"
                    : place.precision}
                </small>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {trip.photos.length ? (
        <section className={styles.gallery} aria-labelledby="trip-photo-title">
          <header>
            <p>Contact sheet · Page {trip.pagination.page} of {trip.pagination.pages}</p>
            <h2 id="trip-photo-title">Photographs from the trip</h2>
            <nav className={styles.pageSizes} aria-label="Photos per page">
              <span>Show</span>
              {PAGE_SIZES.map((pageSize) =>
                pageSize === trip.pagination.pageSize ? (
                  <b aria-current="page" key={pageSize}>{pageSize}</b>
                ) : (
                  <Link
                    href={pageSizeHref(trip, pageSize, previewFixture)}
                    key={pageSize}
                    prefetch={false}
                  >
                    {pageSize}
                  </Link>
                ),
              )}
            </nav>
          </header>
          <ol>
            {trip.photos.map((photo, index) => (
              <li key={photo.id} data-orientation={photo.aspectRatio < 0.86 ? "portrait" : "landscape"}>
                <figure>
                  {/* Public travel media is already emitted as fixed, stripped,
                      content-addressed variants by the protected media route. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={photo.alt}
                    decoding="async"
                    height={photo.height}
                    loading={index < 2 ? "eager" : "lazy"}
                    sizes="(max-width: 680px) 100vw, (max-width: 1100px) 50vw, 34vw"
                    src={travelPhotoUrl(photo, "960")}
                    srcSet={travelPhotoSrcSet(photo)}
                    width={photo.width}
                  />
                  {photo.caption || photo.capturedAt || photo.tags.length ? (
                    <figcaption>
                      {photo.caption ? <p>{photo.caption}</p> : null}
                      <div>
                        {photo.capturedAt ? (
                          <time dateTime={photo.capturedAt}>{photo.capturedAt}</time>
                        ) : (
                          <span>Date withheld</span>
                        )}
                        {photo.tags.length ? <span>{photo.tags.join(" · ")}</span> : null}
                      </div>
                    </figcaption>
                  ) : null}
                </figure>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className={styles.noPhotos} aria-labelledby="trip-photo-title">
          <p>Public photo status</p>
          <h2 id="trip-photo-title">This signal carries geography, not photographs.</h2>
          <span>Planned and current trips stay deliberately broad until they are complete.</span>
        </section>
      )}

      {trip.pagination.pages > 1 ? (
        <nav className={styles.pagination} aria-label="Trip photo pages">
          {trip.pagination.page > 1 ? (
            <Link
              href={paginationHref(
                trip,
                trip.pagination.page - 1,
                previewFixture,
              )}
              prefetch={false}
            >
              ← Previous
            </Link>
          ) : <span />}
          <span>{trip.pagination.page} / {trip.pagination.pages}</span>
          {trip.pagination.page < trip.pagination.pages ? (
            <Link
              href={paginationHref(
                trip,
                trip.pagination.page + 1,
                previewFixture,
              )}
              prefetch={false}
            >
              Next →
            </Link>
          ) : <span />}
        </nav>
      ) : null}

      <footer className={styles.returnLink}>
        <Link
          href={
            previewFixture
              ? `/play/travel?fixture=${encodeURIComponent(previewFixture)}`
              : "/play/travel"
          }
          prefetch={false}
        >
          ← Return to Postcard Planet
        </Link>
      </footer>
    </main>
  );
}
