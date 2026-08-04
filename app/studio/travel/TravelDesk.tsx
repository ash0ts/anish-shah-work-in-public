"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
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
  isRestrictedTravelStatus,
  quantizePublicCoordinate,
  TRAVEL_SAFETY_CHECKS,
} from "./contracts";
import type {
  StudioTravelPhoto,
  StudioTravelPlace,
  StudioTravelTrip,
  TravelPlaceDraft,
  TravelSafetyCheck,
  TravelTripDraft,
} from "./contracts";
import type { TravelProjectedTrip, TravelTripPreview } from "@/types/travel";
import {
  createLocalPhotoCandidate,
  disposeLocalPhotoCandidate,
  parseTagInput,
  suggestedPlaceGroup,
} from "./photo-intake";
import type { LocalPhotoCandidate } from "./photo-intake";
import { loadTravelGeographyResolver } from "./geography-resolver";
import type {
  TravelGeographyResolver,
  TravelGeographySuggestion,
} from "./geography-resolver";
import styles from "./travel.module.css";

type Environment = "local" | "staging" | "production";
type LoadState = "loading" | "ready" | "error";
type DeskView = "edit" | "preview";

const TRAVEL_BATCH_MAX_FILES = 8;

const EMPTY_PLACE: TravelPlaceDraft = {
  label: "",
  countryCode: "",
  countryName: "",
  admin1Code: null,
  admin1Name: null,
  precision: "region",
  publicPoint: { lat: 0, lng: 0 },
  sortOrder: 0,
};

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

function TripEditor({
  draft,
  creating,
  pending,
  onChange,
  onSave,
  onDelete,
}: {
  draft: TravelTripDraft;
  creating: boolean;
  pending: boolean;
  onChange: (draft: TravelTripDraft) => void;
  onSave: () => void;
  onDelete: (() => void) | null;
}) {
  const restricted = isRestrictedTravelStatus(draft.status);
  return (
    <section className={styles.panel} aria-labelledby="trip-details-title">
      <div className={styles.panelHeading}>
        <span>01 · Journey</span>
        <h3 id="trip-details-title">{creating ? "Create a private trip" : "Trip details"}</h3>
      </div>
      <form
        className={styles.formGrid}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label className={styles.spanTwo}>
          Trip title
          <input
            required
            maxLength={100}
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
          />
        </label>
        <label className={styles.spanTwo}>
          Public summary
          <textarea
            required
            rows={4}
            maxLength={600}
            value={draft.summary}
            onChange={(event) => onChange({ ...draft, summary: event.target.value })}
          />
        </label>
        <label>
          Trip status
          <select
            value={draft.status}
            onChange={(event) => {
              const status = event.target.value as TravelTripDraft["status"];
              onChange({
                ...draft,
                status,
                period: {
                  ...draft.period,
                  precision:
                    isRestrictedTravelStatus(status) && draft.period.precision === "day"
                      ? "month"
                      : draft.period.precision,
                },
              });
            }}
          >
            <option value="planned">Planned</option>
            <option value="current">Current</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label>
          Date precision
          <select
            value={draft.period.precision}
            onChange={(event) =>
              onChange({
                ...draft,
                period: {
                  ...draft.period,
                  precision: event.target.value as TravelTripDraft["period"]["precision"],
                },
              })
            }
          >
            <option value="year">Year</option>
            <option value="month">Month</option>
            {!restricted ? <option value="day">Day</option> : null}
          </select>
        </label>
        <label>
          Start
          <input
            required
            type={draft.period.precision === "day" ? "date" : draft.period.precision === "month" ? "month" : "number"}
            min={draft.period.precision === "year" ? "1900" : undefined}
            max={draft.period.precision === "year" ? "2200" : undefined}
            value={draft.period.start}
            onChange={(event) =>
              onChange({ ...draft, period: { ...draft.period, start: event.target.value } })
            }
          />
        </label>
        <label>
          End <small>optional</small>
          <input
            type={draft.period.precision === "day" ? "date" : draft.period.precision === "month" ? "month" : "number"}
            min={draft.period.precision === "year" ? "1900" : undefined}
            max={draft.period.precision === "year" ? "2200" : undefined}
            value={draft.period.end ?? ""}
            onChange={(event) =>
              onChange({
                ...draft,
                period: { ...draft.period, end: event.target.value || null },
              })
            }
          />
        </label>
        {restricted ? (
          <p className={`${styles.warning} ${styles.spanTwo}`}>
            Planned and current trips publish at country or region precision,
            with month-level dates and no public photos.
          </p>
        ) : null}
        <div className={`${styles.actions} ${styles.spanTwo}`}>
          <button type="submit" disabled={pending}>
            {pending ? "Saving…" : creating ? "Create private trip" : "Save trip details"}
          </button>
          {onDelete ? (
            <button className={styles.dangerButton} type="button" onClick={onDelete}>
              Delete private trip
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function PlaceEditor({
  trip,
  draft,
  editingPlaceId,
  pending,
  onChange,
  onEdit,
  onSave,
  onCancel,
  onRemove,
}: {
  trip: StudioTravelTrip;
  draft: TravelPlaceDraft;
  editingPlaceId: string | null;
  pending: boolean;
  onChange: Dispatch<SetStateAction<TravelPlaceDraft>>;
  onEdit: (place: StudioTravelPlace) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: (place: StudioTravelPlace) => void;
}) {
  const restricted = isRestrictedTravelStatus(trip.status);
  const [resolver, setResolver] = useState<TravelGeographyResolver | null>(null);
  const [resolverReady, setResolverReady] = useState(false);
  const [geographyState, setGeographyState] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "suggested"; value: TravelGeographySuggestion }
    | { kind: "manual" }
  >({ kind: "idle" });
  const [suggestionConfirmed, setSuggestionConfirmed] = useState(false);
  const latitudeInputRef = useRef<HTMLInputElement>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const lookupSequenceRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadTravelGeographyResolver(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setResolver(next);
        setResolverReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolverReady(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => lookupAbortRef.current?.abort(), []);

  const selectMapPoint = useCallback(
    async (lat: number, lng: number) => {
      const publicPoint = {
        lat: quantizePublicCoordinate(lat),
        lng: quantizePublicCoordinate(lng),
      };
      onChange((current) => ({ ...current, publicPoint }));
      setSuggestionConfirmed(false);

      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;
      const sequence = ++lookupSequenceRef.current;

      if (!resolver) {
        setGeographyState({ kind: "manual" });
        return;
      }
      setGeographyState({ kind: "checking" });
      try {
        const suggestion = await resolver.suggest(
          publicPoint.lat,
          publicPoint.lng,
          controller.signal,
        );
        if (controller.signal.aborted || sequence !== lookupSequenceRef.current) {
          return;
        }
        if (!suggestion) {
          setGeographyState({ kind: "manual" });
          return;
        }
        onChange((current) => ({
          ...current,
          publicPoint,
          countryCode: suggestion.countryCode,
          countryName: suggestion.countryName,
          admin1Code: suggestion.admin1Code,
          admin1Name: suggestion.admin1Name,
        }));
        setGeographyState({ kind: "suggested", value: suggestion });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setGeographyState({ kind: "manual" });
        }
      }
    },
    [onChange, resolver],
  );

  const suggestionNeedsConfirmation =
    geographyState.kind === "suggested" && !suggestionConfirmed;
  return (
    <section className={styles.panel} aria-labelledby="places-title">
      <div className={styles.panelHeading}>
        <span>02 · Public geography</span>
        <h3 id="places-title">Place the approved pin</h3>
        <p>
          The grid writes only a one-decimal public coordinate. Exact EXIF GPS
          never enters a public field and is stripped from the stored master.
        </p>
      </div>
      <div className={styles.mapWorkspace}>
        <div>
          <button
            type="button"
            className={styles.mapTable}
            aria-label="Choose an approximate public point on a world map"
            aria-describedby="travel-map-instructions"
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              latitudeInputRef.current?.focus();
            }}
            onClick={(event) => {
              if (event.detail === 0) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const lng = ((event.clientX - bounds.left) / bounds.width) * 360 - 180;
              const lat = 90 - ((event.clientY - bounds.top) / bounds.height) * 180;
              void selectMapPoint(lat, lng);
            }}
          >
            <span className={styles.equator} aria-hidden="true" />
            <span className={styles.meridian} aria-hidden="true" />
            {trip.places.map((place) => (
              <i
                aria-hidden="true"
                key={place.id}
                className={styles.savedPin}
                style={{
                  left: `${((place.publicPoint.lng + 180) / 360) * 100}%`,
                  top: `${((90 - place.publicPoint.lat) / 180) * 100}%`,
                }}
              />
            ))}
            <i
              aria-hidden="true"
              className={styles.draftPin}
              style={{
                left: `${((draft.publicPoint.lng + 180) / 360) * 100}%`,
                top: `${((90 - draft.publicPoint.lat) / 180) * 100}%`,
              }}
            />
            <span className={styles.mapInstruction}>Click a broad public point</span>
          </button>
          <p id="travel-map-instructions" className={styles.mapHelp}>
            Pointer users can choose a broad point on the map. Keyboard users
            can enter the public latitude and longitude in the labeled fields.
          </p>
          <ul className={styles.placeList} aria-label="Saved public places">
            {trip.places.map((place) => (
              <li key={place.id}>
                <button type="button" onClick={() => onEdit(place)}>
                  <span>{place.label}</span>
                  <small>{place.countryCode}{place.admin1Code ? ` · ${place.admin1Code}` : ""} · {place.precision.replace("_", " ")}</small>
                </button>
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={placePhotoCount(trip, place.id) > 0}
                  onClick={() => onRemove(place)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
        <form
          className={styles.placeForm}
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <p className={styles.formTitle}>{editingPlaceId ? "Edit place" : "Add place"}</p>
          <div className={styles.geographySuggestion}>
            <div role="status" aria-live="polite" aria-atomic="true">
              {!resolverReady ? (
                <p>Loading first-party Natural Earth boundaries…</p>
              ) : geographyState.kind === "checking" ? (
                <p>Checking first-party Natural Earth boundaries…</p>
              ) : geographyState.kind === "suggested" ? (
                <p>
                  Suggested <strong>{geographyState.value.countryName}</strong>
                  {geographyState.value.admin1Name ? (
                    <> / <strong>{geographyState.value.admin1Name}</strong></>
                  ) : null} from first-party Natural Earth boundaries. Confirm
                  or edit the public fields before saving.
                </p>
              ) : geographyState.kind === "manual" ? (
                <p>
                  No reliable boundary suggestion was found. Enter and review the
                  public geography manually before saving.
                </p>
              ) : (
                <p>
                  Select the map to suggest country and available state/province
                  fields from packaged Natural Earth data.
                </p>
              )}
            </div>
            {geographyState.kind === "suggested" ? (
              <label className={styles.confirmSuggestion}>
                <input
                  type="checkbox"
                  checked={suggestionConfirmed}
                  onChange={(event) =>
                    setSuggestionConfirmed(event.target.checked)
                  }
                />
                <span>I reviewed this geography suggestion.</span>
              </label>
            ) : null}
          </div>
          <label>
            Public label
            <input required maxLength={80} value={draft.label} onChange={(event) => onChange({ ...draft, label: event.target.value })} />
          </label>
          <div className={styles.shortFields}>
            <label>
              Country code
              <input required pattern="[A-Za-z]{2}" maxLength={2} value={draft.countryCode} onChange={(event) => onChange({ ...draft, countryCode: event.target.value.toUpperCase() })} />
            </label>
            <label>
              Country name
              <input required maxLength={100} value={draft.countryName} onChange={(event) => onChange({ ...draft, countryName: event.target.value })} />
            </label>
          </div>
          <div className={styles.shortFields}>
            <label>
              Region code <small>optional</small>
              <input maxLength={12} value={draft.admin1Code ?? ""} onChange={(event) => onChange({ ...draft, admin1Code: event.target.value.toUpperCase() || null })} />
            </label>
            <label>
              Region name <small>optional</small>
              <input maxLength={100} value={draft.admin1Name ?? ""} onChange={(event) => onChange({ ...draft, admin1Name: event.target.value || null })} />
            </label>
          </div>
          <label>
            Public precision
            <select value={draft.precision} onChange={(event) => onChange({ ...draft, precision: event.target.value as TravelPlaceDraft["precision"] })}>
              <option value="country">Country</option>
              <option value="region">Region / state</option>
              {!restricted ? <option value="city_approximate">Approximate city</option> : null}
            </select>
          </label>
          <div className={styles.shortFields}>
            <label>
              Public latitude
              <input ref={latitudeInputRef} type="number" min={-90} max={90} step={0.1} value={draft.publicPoint.lat} onChange={(event) => onChange({ ...draft, publicPoint: { ...draft.publicPoint, lat: Number(event.target.value) } })} />
            </label>
            <label>
              Public longitude
              <input type="number" min={-180} max={180} step={0.1} value={draft.publicPoint.lng} onChange={(event) => onChange({ ...draft, publicPoint: { ...draft.publicPoint, lng: Number(event.target.value) } })} />
            </label>
          </div>
          <div className={styles.actions}>
            <button type="submit" disabled={pending || suggestionNeedsConfirmation}>{pending ? "Saving…" : editingPlaceId ? "Update place" : "Add place"}</button>
            {editingPlaceId ? <button type="button" className={styles.textButton} onClick={onCancel}>Cancel</button> : null}
          </div>
        </form>
      </div>
    </section>
  );
}

function PhotoIntake({
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

function TravelPublicPreview({ preview }: { preview: TravelTripPreview }) {
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

function PublicationGate({
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

function toTripDraft(trip: StudioTravelTrip): TravelTripDraft {
  return {
    title: trip.title,
    summary: trip.summary,
    status: trip.status,
    period: { ...trip.period },
  };
}

function toPlaceDraft(place: StudioTravelPlace): TravelPlaceDraft {
  return {
    label: place.label,
    countryCode: place.countryCode,
    countryName: place.countryName ?? place.countryCode,
    admin1Code: place.admin1Code,
    admin1Name: place.admin1Name ?? place.admin1Code,
    precision: place.precision,
    publicPoint: { ...place.publicPoint },
    sortOrder: place.sortOrder ?? 0,
  };
}

function normalizePlaceDraft(draft: TravelPlaceDraft): TravelPlaceDraft {
  return {
    label: draft.label.trim(),
    countryCode: draft.countryCode.trim().toUpperCase(),
    countryName: draft.countryName.trim(),
    admin1Code: draft.admin1Code?.trim().toUpperCase() || null,
    admin1Name: draft.admin1Name?.trim() || null,
    precision: draft.precision,
    publicPoint: {
      lat: quantizePublicCoordinate(draft.publicPoint.lat),
      lng: quantizePublicCoordinate(draft.publicPoint.lng),
    },
    sortOrder: draft.sortOrder,
  };
}

function validateTripDraft(draft: TravelTripDraft): string | null {
  if (!draft.title.trim() || !draft.summary.trim() || !draft.period.start) {
    return "Add a title, summary, and start period before saving.";
  }
  if (isRestrictedTravelStatus(draft.status) && draft.period.precision === "day") {
    return "Planned and current trips cannot store day-level public dates.";
  }
  if (draft.period.end && draft.period.end < draft.period.start) {
    return "The end period must be on or after the start period.";
  }
  return null;
}

function validatePlaceDraft(
  draft: TravelPlaceDraft,
  status: StudioTravelTrip["status"],
): string | null {
  if (!draft.label || !/^[A-Z]{2}$/.test(draft.countryCode) || !draft.countryName) {
    return "Add a place label, country name, and two-letter country code.";
  }
  if (!Number.isFinite(draft.publicPoint.lat) || Math.abs(draft.publicPoint.lat) > 90 || !Number.isFinite(draft.publicPoint.lng) || Math.abs(draft.publicPoint.lng) > 180) {
    return "Choose a valid approximate latitude and longitude.";
  }
  if (isRestrictedTravelStatus(status) && draft.precision === "city_approximate") {
    return "Planned and current trips may publish only country or region precision.";
  }
  return null;
}

function publicationIssue(
  trip: StudioTravelTrip,
  checks: Set<TravelSafetyCheck>,
): string | null {
  if (!trip.title.trim() || !trip.summary.trim() || !trip.period.start) {
    return "Save complete trip details before publishing.";
  }
  if (trip.places.length === 0) return "Add at least one approved public place.";
  if (isRestrictedTravelStatus(trip.status)) {
    if (trip.period.precision === "day") return "Use month- or year-level timing for planned/current travel.";
    if (trip.places.some((place) => place.precision === "city_approximate")) return "Remove approximate-city pins from planned/current travel.";
    if (trip.photos.length > 0) return "Planned/current trips cannot publish while photos are attached.";
  } else if (trip.photos.some((photo) => !photo.altText.trim() || !photo.placeId)) {
    return "Every completed-trip photo needs a place and useful alt text.";
  }
  if (checks.size !== TRAVEL_SAFETY_CHECKS.length) return "Complete every safety check before publishing.";
  return null;
}

function formatPeriod(
  trip: Pick<StudioTravelTrip | TravelProjectedTrip, "period">,
): string {
  return trip.period.end ? `${trip.period.start}–${trip.period.end}` : trip.period.start;
}

function commonPlaceId(photos: LocalPhotoCandidate[]): string {
  const first = photos[0]?.placeId ?? "";
  return photos.every((photo) => photo.placeId === first) ? first : "";
}

function placePhotoCount(trip: StudioTravelTrip, placeId: string): number {
  return trip.photos.filter((photo) => photo.placeId === placeId).length;
}

function ownerPhotoPreviewSrc(photo: { id: string }): string {
  return `/api/studio/travel/photos/${encodeURIComponent(photo.id)}/preview`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
