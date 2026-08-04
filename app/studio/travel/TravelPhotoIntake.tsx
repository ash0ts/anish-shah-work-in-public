"use client";

import {
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  StudioTravelPhoto,
  StudioTravelPlace,
  StudioTravelTrip,
} from "./contracts";
import {
  parseTagInput,
  suggestedPlaceGroup,
  type LocalPhotoCandidate,
} from "./photo-intake";
import {
  commonPlaceId,
  ownerPhotoPreviewSrc,
} from "./travel-desk-model";
import styles from "./travel.module.css";

export const TRAVEL_BATCH_MAX_FILES = 8;

export function PhotoIntake({
  trip,
  queue,
  dropActive,
  pending,
  onDropActive,
  onFiles,
  onQueueChange,
  onRemoveQueued,
  onUpload,
  onSavePhoto,
  onMovePhoto,
  onRemovePhoto,
}: {
  trip: StudioTravelTrip;
  queue: LocalPhotoCandidate[];
  dropActive: boolean;
  pending: string | null;
  onDropActive: (active: boolean) => void;
  onFiles: (files: File[]) => void;
  onQueueChange: (queue: LocalPhotoCandidate[]) => void;
  onRemoveQueued: (candidate: LocalPhotoCandidate) => void;
  onUpload: () => void;
  onSavePhoto: (photo: StudioTravelPhoto, patch: Partial<StudioTravelPhoto>) => void;
  onMovePhoto: (
    photo: StudioTravelPhoto,
    direction: "earlier" | "later",
  ) => void;
  onRemovePhoto: (photo: StudioTravelPhoto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => {
    const result = new Map<string, LocalPhotoCandidate[]>();
    queue.forEach((photo) => {
      const group = suggestedPlaceGroup(photo.suggestion);
      result.set(group, [...(result.get(group) ?? []), photo]);
    });
    return Array.from(result.entries());
  }, [queue]);
  return (
    <section className={styles.panel} aria-labelledby="photos-title">
      <div className={styles.panelHeading}>
        <span>03 · Contact sheet</span>
        <h3 id="photos-title">Review every frame</h3>
        <p>
          Selection, date, and GPS suggestions happen locally. The protected
          upload carries raw bytes for immediate metadata stripping, plus only
          reviewed public fields—never the local filename.
        </p>
      </div>
      <div
        className={`${styles.dropZone} ${dropActive ? styles.dropActive : ""}`}
        onDragEnter={(event) => { event.preventDefault(); onDropActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDropActive(false);
          onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={inputRef}
          className={styles.visuallyHidden}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <p>
          <strong>Drop a batch here</strong>
          <span>
            JPEG, PNG, WebP, HEIC · 20 MB each · up to {TRAVEL_BATCH_MAX_FILES} per batch
          </span>
        </p>
        <button type="button" disabled={pending !== null || trip.places.length === 0} onClick={() => inputRef.current?.click()}>
          Choose photos
        </button>
        {trip.places.length === 0 ? <small>Add an approved place before staging photos.</small> : null}
      </div>

      {groups.length > 0 ? (
        <div className={styles.suggestionSummary}>
          <span>Local clustering suggestions</span>
          <p>
            Assign a whole suggested cluster to merge it. Change an individual
            photo below to split or reassign it.
          </p>
          <ul>
            {groups.map(([label, photos]) => (
              <li key={label}>
                <span>{label} · {photos.length}</span>
                <label>
                  <span className={styles.visuallyHidden}>Assign {label}</span>
                  <select
                    value={commonPlaceId(photos)}
                    onChange={(event) => {
                      const localIds = new Set(photos.map((photo) => photo.localId));
                      onQueueChange(
                        queue.map((photo) =>
                          localIds.has(photo.localId)
                            ? { ...photo, placeId: event.target.value }
                            : photo,
                        ),
                      );
                    }}
                  >
                    <option value="">Assign cluster…</option>
                    {trip.places.map((place) => (
                      <option value={place.id} key={place.id}>{place.label}</option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {queue.length > 0 ? (
        <>
          <div className={styles.contactSheet} aria-label="Locally staged photos">
            {queue.map((candidate, index) => (
              <QueuedPhotoCard
                key={candidate.localId}
                candidate={candidate}
                index={index}
                places={trip.places}
                disabled={pending === "upload"}
                onChange={(patch) =>
                  onQueueChange(queue.map((item) => item.localId === candidate.localId ? { ...item, ...patch } : item))
                }
                onRemove={() => onRemoveQueued(candidate)}
              />
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={pending !== null} onClick={onUpload}>
              {pending === "upload" ? "Processing securely…" : `Upload ${queue.length} reviewed photo${queue.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      ) : null}

      {trip.photos.length > 0 ? (
        <div className={styles.contactSheet} aria-label="Stored trip photos">
          {[...trip.photos].sort((a, b) => a.sortOrder - b.sortOrder).map((photo, index) => (
            <StoredPhotoCard
              key={`${photo.id}:${trip.revision}`}
              photo={photo}
              index={index}
              total={trip.photos.length}
              places={trip.places}
              disabled={pending === `photo:${photo.id}`}
              onSave={(patch) => onSavePhoto(photo, patch)}
              onMove={(direction) => onMovePhoto(photo, direction)}
              onRemove={() => onRemovePhoto(photo)}
            />
          ))}
        </div>
      ) : (
        <p className={styles.emptyContact}>No processed photos in this trip yet.</p>
      )}
    </section>
  );
}

function QueuedPhotoCard({
  candidate,
  index,
  places,
  disabled,
  onChange,
  onRemove,
}: {
  candidate: LocalPhotoCandidate;
  index: number;
  places: StudioTravelPlace[];
  disabled: boolean;
  onChange: (patch: Partial<LocalPhotoCandidate>) => void;
  onRemove: () => void;
}) {
  return (
    <article className={styles.photoCard} aria-labelledby={`queued-photo-${candidate.localId}`}>
      {/* The image is a local object URL and is never placed in a request. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={candidate.previewSrc} alt="" />
      <div className={styles.photoCardBody}>
        <p id={`queued-photo-${candidate.localId}`} className={styles.photoNumber}>Queued photo {index + 1}</p>
        <small>{suggestedPlaceGroup(candidate.suggestion)} · {candidate.suggestion.source.replaceAll("-", " ")}</small>
        <label>Place<select required value={candidate.placeId} onChange={(event) => onChange({ placeId: event.target.value })}><option value="">Choose place</option>{places.map((place) => <option value={place.id} key={place.id}>{place.label}</option>)}</select></label>
        <label>Alt text<textarea required rows={3} maxLength={300} value={candidate.altText} onChange={(event) => onChange({ altText: event.target.value })} /></label>
        <label>Caption <small>optional</small><textarea rows={2} maxLength={500} value={candidate.caption} onChange={(event) => onChange({ caption: event.target.value })} /></label>
        <label>Capture date <small>review suggestion</small><input type="date" value={candidate.capturedAt} onChange={(event) => onChange({ capturedAt: event.target.value })} /></label>
        <label>Tags <small>comma separated</small><input maxLength={240} value={candidate.tags} onChange={(event) => onChange({ tags: event.target.value })} /></label>
        <label className={styles.checkLine}><input type="checkbox" checked={candidate.isCover} onChange={(event) => onChange({ isCover: event.target.checked })} />Use as trip cover</label>
        {candidate.error ? <p className={styles.cardError}>{candidate.error}</p> : null}
        <button type="button" className={styles.textButton} disabled={disabled} onClick={onRemove}>Remove from local queue</button>
      </div>
    </article>
  );
}

function StoredPhotoCard({
  photo,
  index,
  total,
  places,
  disabled,
  onSave,
  onMove,
  onRemove,
}: {
  photo: StudioTravelPhoto;
  index: number;
  total: number;
  places: StudioTravelPlace[];
  disabled: boolean;
  onSave: (patch: Partial<StudioTravelPhoto>) => void;
  onMove: (direction: "earlier" | "later") => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(photo);
  return (
    <article className={styles.photoCard} aria-labelledby={`stored-photo-${photo.id}`}>
      {ownerPhotoPreviewSrc(photo) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ownerPhotoPreviewSrc(photo)} alt="" />
      ) : <div className={styles.photoFallback}>Preview unavailable</div>}
      <form
        className={styles.photoCardBody}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <p id={`stored-photo-${photo.id}`} className={styles.photoNumber}>Photo {index + 1} of {total}</p>
        <label>Place<select value={draft.placeId ?? ""} onChange={(event) => setDraft({ ...draft, placeId: event.target.value || null })}>{places.map((place) => <option value={place.id} key={place.id}>{place.label}</option>)}</select></label>
        <label>Alt text<textarea required rows={3} maxLength={300} value={draft.altText} onChange={(event) => setDraft({ ...draft, altText: event.target.value })} /></label>
        <label>Caption <small>optional</small><textarea rows={2} maxLength={500} value={draft.caption ?? ""} onChange={(event) => setDraft({ ...draft, caption: event.target.value || null })} /></label>
        <label>Capture date<input type="date" value={draft.capturedAt ?? ""} onChange={(event) => setDraft({ ...draft, capturedAt: event.target.value || null })} /></label>
        <label>Tags<input value={draft.tags.join(", ")} onChange={(event) => setDraft({ ...draft, tags: parseTagInput(event.target.value) })} /></label>
        <label className={styles.checkLine}><input type="checkbox" checked={draft.isCover} onChange={(event) => setDraft({ ...draft, isCover: event.target.checked })} />Use as trip cover</label>
        <div className={styles.photoOrder} aria-label="Photo order">
          <button type="button" disabled={disabled || index === 0} onClick={() => onMove("earlier")}>Move earlier</button>
          <button type="button" disabled={disabled || index === total - 1} onClick={() => onMove("later")}>Move later</button>
        </div>
        <div className={styles.actions}>
          <button type="submit" disabled={disabled}>{disabled ? "Saving…" : "Save photo"}</button>
          <button type="button" className={styles.dangerButton} disabled={disabled} onClick={onRemove}>Delete photo</button>
        </div>
      </form>
    </article>
  );
}


