"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import type { TravelTripPreview } from "@/types/travel";
import {
  beginTravelUpload,
  createTravelPlace,
  createTravelTrip,
  deleteTravelPhoto,
  deleteTravelPlace,
  deleteTravelTrip,
  finalizeTravelUpload,
  getTravelTrip,
  getTravelTripPreview,
  listTravelTrips,
  moveTravelPhoto,
  publishTravelTrip,
  putTravelUpload,
  unpublishTravelTrip,
  updateTravelPhoto,
  updateTravelPlace,
  updateTravelTrip,
} from "./api";
import {
  EMPTY_TRIP_DRAFT,
  type StudioTravelPhoto,
  type StudioTravelPlace,
  type StudioTravelTrip,
  type TravelPlaceDraft,
  type TravelSafetyCheck,
  type TravelTripDraft,
} from "./contracts";
import {
  createLocalPhotoCandidate,
  disposeLocalPhotoCandidate,
  parseTagInput,
  type LocalPhotoCandidate,
} from "./photo-intake";
import { TripEditor } from "./TravelTripPanel";
import { PlaceEditor } from "./TravelPlacePanel";
import {
  PhotoIntake,
  TRAVEL_BATCH_MAX_FILES,
} from "./TravelPhotoIntake";
import {
  PublicationGate,
  TravelPublicPreview,
} from "./TravelPublicationPreview";
import {
  EMPTY_PLACE,
  errorMessage,
  normalizePlaceDraft,
  placePhotoCount,
  publicationIssue,
  toPlaceDraft,
  toTripDraft,
  validatePlaceDraft,
  validateTripDraft,
} from "./travel-desk-model";
import styles from "./travel.module.css";

type Environment = "local" | "staging" | "production";
type LoadState = "loading" | "ready" | "error";
type DeskView = "edit" | "preview";

export function TravelDesk({ environment }: { environment: Environment }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [trips, setTrips] = useState<StudioTravelTrip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tripDraft, setTripDraft] = useState<TravelTripDraft>(EMPTY_TRIP_DRAFT);
  const [placeDraft, setPlaceDraft] = useState<TravelPlaceDraft>(EMPTY_PLACE);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [queue, setQueue] = useState<LocalPhotoCandidate[]>([]);
  const [view, setView] = useState<DeskView>("edit");
  const [publicPreview, setPublicPreview] =
    useState<TravelTripPreview | null>(null);
  const [previewState, setPreviewState] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Set<TravelSafetyCheck>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const editTabRef = useRef<HTMLButtonElement>(null);
  const previewTabRef = useRef<HTMLButtonElement>(null);
  const previewRequestRef = useRef(0);
  const intakeActiveRef = useRef(false);
  const queueRef = useRef<LocalPhotoCandidate[]>([]);

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedId) ?? null,
    [selectedId, trips],
  );

  const announce = useCallback((value: string) => {
    setMessage(value);
  }, []);

  const loadPublicPreview = useCallback(async (trip: StudioTravelTrip) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewState("loading");
    setPreviewError(null);
    setPublicPreview(null);
    try {
      const preview = await getTravelTripPreview(trip.id);
      if (previewRequestRef.current !== requestId) return;
      setPublicPreview(preview);
      setPreviewState("ready");
    } catch (error) {
      if (previewRequestRef.current !== requestId) return;
      setPreviewError(
        errorMessage(
          error,
          "The stored trip could not be projected into the public contract.",
        ),
      );
      setPreviewState("error");
    }
  }, []);

  const selectViewTab = useCallback(
    (nextView: DeskView, moveFocus = false) => {
      if (nextView === "preview" && !selectedTrip) return;
      if (nextView === "preview" && selectedTrip) {
        void loadPublicPreview(selectedTrip);
      } else {
        previewRequestRef.current += 1;
      }
      setView(nextView);
      if (moveFocus) {
        requestAnimationFrame(() => {
          (nextView === "edit" ? editTabRef : previewTabRef).current?.focus();
        });
      }
    },
    [loadPublicPreview, selectedTrip],
  );

  const onViewTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const enabledViews: DeskView[] = selectedTrip
        ? ["edit", "preview"]
        : ["edit"];
      const currentIndex = Math.max(0, enabledViews.indexOf(view));
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = enabledViews.length - 1;
      else if (event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % enabledViews.length;
      } else {
        nextIndex =
          (currentIndex - 1 + enabledViews.length) % enabledViews.length;
      }
      selectViewTab(enabledViews[nextIndex], true);
    },
    [selectViewTab, selectedTrip, view],
  );

  const replaceTrip = useCallback((trip: StudioTravelTrip) => {
    previewRequestRef.current += 1;
    setTrips((current) =>
      current.some((item) => item.id === trip.id)
        ? current.map((item) => (item.id === trip.id ? trip : item))
        : [trip, ...current],
    );
    setSelectedId(trip.id);
    setTripDraft(toTripDraft(trip));
    setChecks(new Set());
    setPublicPreview(null);
    setPreviewState("idle");
    setPreviewError(null);
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    return () => {
      queueRef.current.forEach(disposeLocalPhotoCandidate);
    };
  }, []);

  const load = useCallback(async () => {
    setLoadState("loading");
    setMessage(null);
    try {
      const next = await listTravelTrips();
      const selected =
        next.find((trip) => trip.id === selectedId) ?? next[0] ?? null;
      setTrips(next);
      setSelectedId(selected?.id ?? null);
      if (selected) setTripDraft(toTripDraft(selected));
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      announce(errorMessage(error, "Travel Desk could not be loaded."));
    }
  }, [announce, selectedId]);

  useEffect(() => {
    let active = true;
    void listTravelTrips()
      .then((next) => {
        if (!active) return;
        setTrips(next);
        setSelectedId(next[0]?.id ?? null);
        if (next[0]) setTripDraft(toTripDraft(next[0]));
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadState("error");
        announce(errorMessage(error, "Travel Desk could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [announce]);

  function selectTrip(trip: StudioTravelTrip) {
    if (queue.length > 0 && !window.confirm("Discard the queued local photos and open another trip?")) {
      return;
    }
    clearQueue();
    previewRequestRef.current += 1;
    setSelectedId(trip.id);
    setTripDraft(toTripDraft(trip));
    setCreating(false);
    setEditingPlaceId(null);
    setPlaceDraft(EMPTY_PLACE);
    setChecks(new Set());
    setView("edit");
    setMessage(null);
    setPublicPreview(null);
    setPreviewState("idle");
    setPreviewError(null);
  }

  function beginCreate() {
    if (queue.length > 0 && !window.confirm("Discard the queued local photos and start a new trip?")) {
      return;
    }
    clearQueue();
    previewRequestRef.current += 1;
    setSelectedId(null);
    setCreating(true);
    setTripDraft(EMPTY_TRIP_DRAFT);
    setEditingPlaceId(null);
    setPlaceDraft(EMPTY_PLACE);
    setChecks(new Set());
    setView("edit");
    setMessage(null);
    setPublicPreview(null);
    setPreviewState("idle");
    setPreviewError(null);
  }

  function clearQueue() {
    queueRef.current.forEach(disposeLocalPhotoCandidate);
    queueRef.current = [];
    setQueue([]);
  }

  async function saveTrip() {
    const validation = validateTripDraft(tripDraft);
    if (validation) {
      announce(validation);
      return;
    }
    setPending("trip");
    setMessage(null);
    try {
      const trip = selectedTrip
        ? await updateTravelTrip(selectedTrip, tripDraft)
        : await createTravelTrip(tripDraft);
      replaceTrip(trip);
      setCreating(false);
      announce(selectedTrip ? "Trip details saved." : "Trip created as a private draft.");
    } catch (error) {
      announce(errorMessage(error, "The trip could not be saved."));
    } finally {
      setPending(null);
    }
  }

  async function removeTrip() {
    if (!selectedTrip) return;
    if (!window.confirm(`Delete the private trip “${selectedTrip.title}” and its unpublished media?`)) return;
    setPending("delete-trip");
    try {
      await deleteTravelTrip(selectedTrip);
      clearQueue();
      const remaining = trips.filter((trip) => trip.id !== selectedTrip.id);
      setTrips(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setTripDraft(remaining[0] ? toTripDraft(remaining[0]) : EMPTY_TRIP_DRAFT);
      setCreating(remaining.length === 0);
      announce("The private trip was deleted.");
    } catch (error) {
      announce(errorMessage(error, "The trip could not be deleted."));
    } finally {
      setPending(null);
    }
  }

  async function savePlace() {
    if (!selectedTrip) return;
    const normalized = normalizePlaceDraft(placeDraft);
    const validation = validatePlaceDraft(normalized, selectedTrip.status);
    if (validation) {
      announce(validation);
      return;
    }
    setPending("place");
    try {
      const editingPlace = editingPlaceId
        ? selectedTrip.places.find((place) => place.id === editingPlaceId) ?? null
        : null;
      if (editingPlaceId && !editingPlace) {
        announce("The selected place is no longer available. Reload Travel Desk.");
        return;
      }
      if (editingPlace) await updateTravelPlace(editingPlace, normalized);
      else await createTravelPlace(selectedTrip, {
        ...normalized,
        sortOrder: selectedTrip.places.length,
      });
      const trip = await getTravelTrip(selectedTrip.id);
      replaceTrip(trip);
      setEditingPlaceId(null);
      setPlaceDraft(EMPTY_PLACE);
      announce(editingPlaceId ? "Public place updated." : "Public place added.");
    } catch (error) {
      announce(errorMessage(error, "The place could not be saved."));
    } finally {
      setPending(null);
    }
  }

  async function removePlace(place: StudioTravelPlace) {
    if (!selectedTrip) return;
    if (placePhotoCount(selectedTrip, place.id) > 0) {
      announce("Move this place’s photos before removing it.");
      return;
    }
    setPending(`place:${place.id}`);
    try {
      await deleteTravelPlace(place);
      replaceTrip(await getTravelTrip(selectedTrip.id));
      announce("The place was removed.");
    } catch (error) {
      announce(errorMessage(error, "The place could not be removed."));
    } finally {
      setPending(null);
    }
  }

  async function intakeFiles(files: File[]) {
    if (!selectedTrip) {
      announce("Create and save the trip before adding photos.");
      return;
    }
    if (files.length === 0) return;
    if (intakeActiveRef.current) {
      announce("Wait for the current photo batch to finish staging.");
      return;
    }
    const availableSlots = Math.max(
      0,
      TRAVEL_BATCH_MAX_FILES - queueRef.current.length,
    );
    if (availableSlots === 0) {
      announce(
        `Upload or remove part of the current queue before adding more. Each batch is limited to ${TRAVEL_BATCH_MAX_FILES} photos.`,
      );
      return;
    }
    intakeActiveRef.current = true;
    setPending("intake");
    const accepted: LocalPhotoCandidate[] = [];
    const errors: string[] = [];
    const batch = files.slice(0, availableSlots);
    const deferred = Math.max(0, files.length - batch.length);
    for (const [index, file] of batch.entries()) {
      try {
        accepted.push(await createLocalPhotoCandidate(file, queue.length + index));
      } catch (error) {
        errors.push(errorMessage(error, "One photo was rejected."));
      }
    }
    queueRef.current = [...queueRef.current, ...accepted].slice(
      0,
      TRAVEL_BATCH_MAX_FILES,
    );
    setQueue(queueRef.current);
    intakeActiveRef.current = false;
    setPending(null);
    announce(
      `${accepted.length} photo${accepted.length === 1 ? "" : "s"} staged locally.${
        errors.length ? ` ${errors.length} could not be staged.` : ""
      }${
        deferred
          ? ` ${deferred} ${deferred === 1 ? "was" : "were"} not staged because a batch is limited to ${TRAVEL_BATCH_MAX_FILES}.`
          : ""
      }`,
    );
  }

  async function uploadQueue() {
    if (!selectedTrip || queue.length === 0) return;
    const invalid = queue.find((photo) => !photo.placeId || !photo.altText.trim());
    if (invalid) {
      announce("Assign every queued photo to a place and add useful alt text before uploading.");
      return;
    }
    setPending("upload");
    let workingTrip = selectedTrip;
    let completed = 0;
    for (const candidate of [...queue]) {
      setQueue((current) =>
        current.map((item) =>
          item.localId === candidate.localId
            ? { ...item, phase: "uploading", error: null }
            : item,
        ),
      );
      try {
        const upload = await beginTravelUpload({
          tripId: workingTrip.id,
          tripRevision: workingTrip.revision,
          mimeType: candidate.file.type,
          byteSize: candidate.file.size,
        });
        await putTravelUpload(upload, candidate.file);
        const finalized = await finalizeTravelUpload(upload.id, {
          placeId: candidate.placeId,
          altText: candidate.altText.trim(),
          caption: candidate.caption.trim() || null,
          capturedAt: candidate.capturedAt || null,
          capturePrecision: candidate.capturedAt ? "day" : null,
          width: candidate.width,
          height: candidate.height,
          tags: parseTagInput(candidate.tags),
          sortOrder: workingTrip.photos.length + completed,
          isCover: candidate.isCover,
        }, workingTrip.revision);
        workingTrip = {
          ...workingTrip,
          revision: finalized.tripRevision,
          photos: [...workingTrip.photos, finalized.photo],
        };
        completed += 1;
        disposeLocalPhotoCandidate(candidate);
        queueRef.current = queueRef.current.filter(
          (item) => item.localId !== candidate.localId,
        );
        setQueue((current) =>
          current.filter((item) => item.localId !== candidate.localId),
        );
      } catch (error) {
        const message = errorMessage(error, "This photo could not be uploaded.");
        setQueue((current) =>
          current.map((item) =>
            item.localId === candidate.localId
              ? { ...item, phase: "failed", error: message }
              : item,
          ),
        );
        break;
      }
    }
    if (completed > 0) {
      workingTrip = await getTravelTrip(workingTrip.id);
      replaceTrip(workingTrip);
    }
    setPending(null);
    announce(
      completed === queue.length
        ? `Uploaded and processed ${completed} photo${completed === 1 ? "" : "s"}.`
        : `Processed ${completed} photo${completed === 1 ? "" : "s"}; the remaining queue needs attention.`,
    );
  }

  async function savePhoto(photo: StudioTravelPhoto, patch: Partial<StudioTravelPhoto>) {
    if (!selectedTrip) return;
    setPending(`photo:${photo.id}`);
    try {
      await updateTravelPhoto(photo, {
        placeId: patch.placeId ?? photo.placeId,
        altText: patch.altText ?? photo.altText,
        caption: patch.caption === undefined ? photo.caption : patch.caption,
        capturedAt:
          patch.capturedAt === undefined ? photo.capturedAt : patch.capturedAt,
        capturePrecision:
          patch.capturedAt === undefined
            ? photo.capturePrecision
            : patch.capturedAt
              ? "day"
              : null,
        width: photo.width,
        height: photo.height,
        tags: patch.tags ?? photo.tags,
        isCover: patch.isCover ?? photo.isCover,
      });
      replaceTrip(await getTravelTrip(selectedTrip.id));
      announce("Photo details saved.");
    } catch (error) {
      announce(errorMessage(error, "The photo changes could not be saved."));
    } finally {
      setPending(null);
    }
  }

  async function movePhoto(
    photo: StudioTravelPhoto,
    direction: "earlier" | "later",
  ) {
    if (!selectedTrip) return;
    setPending(`photo:${photo.id}`);
    try {
      replaceTrip(await moveTravelPhoto(photo, selectedTrip, direction));
      announce(`Photo moved ${direction}.`);
    } catch (error) {
      announce(errorMessage(error, "The photo could not be moved."));
    } finally {
      setPending(null);
    }
  }

  async function removePhoto(photo: StudioTravelPhoto) {
    if (!selectedTrip || !window.confirm("Remove this photo and its stored derivatives?")) return;
    setPending(`photo:${photo.id}`);
    try {
      await deleteTravelPhoto(photo);
      replaceTrip(await getTravelTrip(selectedTrip.id));
      announce("The photo was removed.");
    } catch (error) {
      announce(errorMessage(error, "The photo could not be removed."));
    } finally {
      setPending(null);
    }
  }

  async function publish() {
    if (!selectedTrip) return;
    const issue = publicationIssue(selectedTrip, checks);
    if (issue) {
      announce(issue);
      return;
    }
    if (!window.confirm(`Publish every approved part of “${selectedTrip.title}” together?`)) return;
    setPending("publish");
    try {
      replaceTrip(await publishTravelTrip(selectedTrip));
      announce(
        environment === "local"
          ? "Created a local-only travel publication. Production is unchanged."
          : "The complete trip is now published in Postcard Planet.",
      );
    } catch (error) {
      announce(errorMessage(error, "The trip could not be published."));
    } finally {
      setPending(null);
    }
  }

  async function unpublish() {
    if (!selectedTrip || !window.confirm("Unpublish this entire trip and every associated photo now?")) return;
    setPending("unpublish");
    try {
      replaceTrip(await unpublishTravelTrip(selectedTrip));
      announce("The trip and all of its photos are no longer public.");
    } catch (error) {
      announce(errorMessage(error, "The trip could not be unpublished."));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.desk} aria-labelledby="travel-desk-title">
      <header className={styles.deskHeader}>
        <div>
          <p className={styles.kicker}>Map table</p>
          <h2 id="travel-desk-title">Travel Desk</h2>
        </div>
        <dl>
          <div><dt>Environment</dt><dd>{environment}</dd></div>
          <div><dt>Trips</dt><dd>{trips.length}</dd></div>
          <div><dt>Queued files</dt><dd>{queue.length}</dd></div>
        </dl>
      </header>

      {loadState === "loading" ? (
        <p className={styles.loading} role="status">Opening the map table…</p>
      ) : loadState === "error" ? (
        <div className={styles.errorState}>
          <p>Travel Desk is unavailable. Existing public travel data is unchanged.</p>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : (
        <div className={styles.workspace}>
          <aside className={styles.tripRail} aria-label="Travel trips">
            <button className={styles.newTrip} type="button" onClick={beginCreate}>
              + New trip
            </button>
            {trips.map((trip) => (
              <button
                type="button"
                key={trip.id}
                aria-pressed={selectedTrip?.id === trip.id}
                className={selectedTrip?.id === trip.id ? styles.activeTrip : undefined}
                onClick={() => selectTrip(trip)}
              >
                <span>{trip.title}</span>
                <small>{trip.status} · {trip.publishedAt ? "published" : "private"}</small>
              </button>
            ))}
            {trips.length === 0 && !creating ? (
              <p>No trips yet. Start with one journey and its broad public footprint.</p>
            ) : null}
          </aside>

          <div className={styles.editor}>
            <div
              className={styles.viewTabs}
              role="tablist"
              aria-label="Travel Desk view"
              onKeyDown={onViewTabKeyDown}
            >
              <button
                ref={editTabRef}
                id="travel-edit-tab"
                role="tab"
                type="button"
                aria-controls="travel-edit-panel"
                aria-selected={view === "edit"}
                tabIndex={view === "edit" ? 0 : -1}
                onClick={() => selectViewTab("edit")}
              >
                Edit trip
              </button>
              <button
                ref={previewTabRef}
                id="travel-preview-tab"
                role="tab"
                type="button"
                aria-controls="travel-preview-panel"
                aria-selected={view === "preview"}
                tabIndex={view === "preview" ? 0 : -1}
                disabled={!selectedTrip}
                onClick={() => selectViewTab("preview")}
              >
                Exact public preview
              </button>
            </div>

            {view === "preview" && selectedTrip ? (
              <div
                id="travel-preview-panel"
                role="tabpanel"
                aria-labelledby="travel-preview-tab"
              >
                {previewState === "loading" ? (
                  <p role="status">Projecting the stored trip through the public contract…</p>
                ) : previewState === "error" ? (
                  <p className={styles.previewRestriction} role="alert">
                    {previewError}
                  </p>
                ) : publicPreview ? (
                  <TravelPublicPreview preview={publicPreview} />
                ) : null}
              </div>
            ) : (
              <div
                id="travel-edit-panel"
                role="tabpanel"
                aria-labelledby="travel-edit-tab"
              >
                <TripEditor
                  draft={tripDraft}
                  creating={creating}
                  pending={pending === "trip"}
                  onChange={setTripDraft}
                  onSave={() => void saveTrip()}
                  onDelete={
                    selectedTrip && !selectedTrip.publishedAt
                      ? () => void removeTrip()
                      : null
                  }
                />
                {selectedTrip ? (
                  <>
                    <PlaceEditor
                      key={editingPlaceId ?? "new-place"}
                      trip={selectedTrip}
                      draft={placeDraft}
                      editingPlaceId={editingPlaceId}
                      pending={pending === "place"}
                      onChange={setPlaceDraft}
                      onEdit={(place) => {
                        setEditingPlaceId(place.id);
                        setPlaceDraft(toPlaceDraft(place));
                      }}
                      onSave={() => void savePlace()}
                      onCancel={() => {
                        setEditingPlaceId(null);
                        setPlaceDraft(EMPTY_PLACE);
                      }}
                      onRemove={(place) => void removePlace(place)}
                    />
                    <PhotoIntake
                      trip={selectedTrip}
                      queue={queue}
                      dropActive={dropActive}
                      pending={pending}
                      onDropActive={setDropActive}
                      onFiles={(files) => void intakeFiles(files)}
                      onQueueChange={setQueue}
                      onRemoveQueued={(candidate) => {
                        disposeLocalPhotoCandidate(candidate);
                        queueRef.current = queueRef.current.filter(
                          (item) => item.localId !== candidate.localId,
                        );
                        setQueue((current) =>
                          current.filter((item) => item.localId !== candidate.localId),
                        );
                      }}
                      onUpload={() => void uploadQueue()}
                      onSavePhoto={(photo, patch) => void savePhoto(photo, patch)}
                      onMovePhoto={(photo, direction) =>
                        void movePhoto(photo, direction)
                      }
                      onRemovePhoto={(photo) => void removePhoto(photo)}
                    />
                    <PublicationGate
                      trip={selectedTrip}
                      checks={checks}
                      pending={pending}
                      environment={environment}
                      onCheck={(check, checked) =>
                        setChecks((current) => {
                          const next = new Set(current);
                          if (checked) next.add(check);
                          else next.delete(check);
                          return next;
                        })
                      }
                      onPreview={() => selectViewTab("preview")}
                      onPublish={() => void publish()}
                      onUnpublish={() => void unpublish()}
                    />
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {message ? (
        <p
          aria-atomic="true"
          className={styles.statusMessage}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
