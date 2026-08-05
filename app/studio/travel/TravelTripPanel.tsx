"use client";

import { isRestrictedTravelStatus, type TravelTripDraft } from "./contracts";
import styles from "./travel.module.css";

export function TripEditor({
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


