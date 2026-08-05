"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  isRestrictedTravelStatus,
  quantizePublicCoordinate,
  type StudioTravelPlace,
  type StudioTravelTrip,
  type TravelPlaceDraft,
} from "./contracts";
import { loadTravelGeographyResolver } from "./geography-resolver";
import type {
  TravelGeographyResolver,
  TravelGeographySuggestion,
} from "./geography-resolver";
import { placePhotoCount } from "./travel-desk-model";
import styles from "./travel.module.css";

export function PlaceEditor({
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


