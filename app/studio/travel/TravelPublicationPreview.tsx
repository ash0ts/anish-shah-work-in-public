"use client";

import type { TravelTripPreview } from "@/types/travel";
import {
  isRestrictedTravelStatus,
  TRAVEL_SAFETY_CHECKS,
  type StudioTravelTrip,
  type TravelSafetyCheck,
} from "./contracts";
import {
  formatPeriod,
  ownerPhotoPreviewSrc,
  publicationIssue,
} from "./travel-desk-model";
import styles from "./travel.module.css";

type Environment = "local" | "staging" | "production";

export function TravelPublicPreview({ preview }: { preview: TravelTripPreview }) {
  const { trip } = preview;
  return (
    <section className={styles.publicPreview} aria-labelledby="public-preview-title">
      <header>
        <p>Exact public projection · {preview.contentHash.slice(0, 10)} · not yet published</p>
        <h3 id="public-preview-title">{trip.title}</h3>
        <span>{formatPeriod(trip)} · {trip.status}</span>
      </header>
      <p className={styles.previewSummary}>{trip.summary}</p>
      <div className={styles.previewPlaces}>
        {trip.places.map((place) => (
          <article key={place.id}>
            <span>{place.countryCode}{place.admin1Code ? ` / ${place.admin1Code}` : ""}</span>
            <h4>{place.label}</h4>
            <p>{place.precision.replace("_", " ")} · {place.publicPoint.lat.toFixed(1)}°, {place.publicPoint.lng.toFixed(1)}°</p>
          </article>
        ))}
      </div>
      {isRestrictedTravelStatus(trip.status) ? (
        <p className={styles.previewRestriction}>
          Planned/current public view: broad geography and month-level timing only. No photos appear.
        </p>
      ) : trip.photos.length > 0 ? (
        <div className={styles.previewPhotos}>
          {trip.photos.map((photo) => (
            <figure key={photo.id}>
              {ownerPhotoPreviewSrc(photo) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ownerPhotoPreviewSrc(photo)} alt={photo.alt} />
              ) : <div className={styles.photoFallback}>Photo</div>}
              {photo.caption ? <figcaption>{photo.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : <p className={styles.previewRestriction}>This completed trip has no public photos yet.</p>}
    </section>
  );
}

export function PublicationGate({
  trip,
  checks,
  pending,
  environment,
  onCheck,
  onPreview,
  onPublish,
  onUnpublish,
}: {
  trip: StudioTravelTrip;
  checks: Set<TravelSafetyCheck>;
  pending: string | null;
  environment: Environment;
  onCheck: (check: TravelSafetyCheck, checked: boolean) => void;
  onPreview: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const issue = publicationIssue(trip, checks);
  return (
    <section className={`${styles.panel} ${styles.publishPanel}`} aria-labelledby="publish-title">
      <div className={styles.panelHeading}>
        <span>04 · Publication boundary</span>
        <h3 id="publish-title">Release the whole trip—or none of it.</h3>
        <p>
          Publication is atomic. Unpublish removes the trip, its places, and
          every associated photo from the active public snapshot immediately.
        </p>
      </div>
      <div className={styles.publishFacts}>
        <span>{trip.places.length} places</span>
        <span>{trip.photos.length} photos</span>
        <span>{trip.publishedAt ? "Currently published" : "Private draft"}</span>
        <span>{environment}</span>
      </div>
      <fieldset className={styles.safetyChecks}>
        <legend>Final safety review</legend>
        {TRAVEL_SAFETY_CHECKS.map((check) => (
          <label key={check.id}>
            <input type="checkbox" checked={checks.has(check.id)} onChange={(event) => onCheck(check.id, event.target.checked)} />
            <span>{check.label}</span>
          </label>
        ))}
      </fieldset>
      {issue ? <p className={styles.warning}>{issue}</p> : null}
      <div className={styles.actions}>
        <button type="button" onClick={onPreview}>Review exact public preview</button>
        <button type="button" disabled={pending !== null || Boolean(issue)} onClick={onPublish}>
          {pending === "publish"
            ? "Publishing…"
            : trip.publishedAt
              ? "Republish complete trip"
              : environment === "local"
                ? "Publish locally"
                : "Publish entire trip"}
        </button>
        {trip.publishedAt ? (
          <button type="button" className={styles.dangerButton} disabled={pending !== null} onClick={onUnpublish}>{pending === "unpublish" ? "Unpublishing…" : "Unpublish entire trip"}</button>
        ) : null}
      </div>
    </section>
  );
}


