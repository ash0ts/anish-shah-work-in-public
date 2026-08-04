import type { CSSProperties } from "react";
import styles from "./StreamPresentation.module.css";
import type {
  CollectionPayload,
  CollectionProvider,
  StatusCount,
} from "./connector-model";

export function PatternView({
  provider,
  payload,
}: {
  provider: CollectionProvider;
  payload: CollectionPayload;
}) {
  if (provider === "myanimelist" && payload.provider === "myanimelist") {
    const total =
      payload.gallery?.libraryTotal ??
      payload.status.reduce((sum, entry) => sum + entry.count, 0);
    return (
      <div className={styles.pattern}>
        <PatternLead
          value={total.toLocaleString()}
          label="titles in the public watch library"
        />
        <Distribution title="Watch state" entries={payload.status} />
        <Distribution title="Recurring genres" entries={payload.genres} />
        <Distribution title="Release eras" entries={payload.eras} />
        {payload.scores?.length ? (
          <Distribution title="Score distribution" entries={payload.scores} />
        ) : null}
      </div>
    );
  }

  if (provider === "hardcover" && payload.provider === "hardcover") {
    const total =
      payload.gallery?.libraryTotal ??
      payload.status.reduce((sum, entry) => sum + entry.count, 0);
    return (
      <div className={styles.pattern}>
        <PatternLead
          value={total.toLocaleString()}
          label="books in the public shelf"
        />
        <Distribution title="Reading state" entries={payload.status} />
        {payload.ratings?.length ? (
          <Distribution title="Rating distribution" entries={payload.ratings} />
        ) : null}
        <RecentIndex
          entries={payload.recent.slice(0, 8).map((entry) => ({
            id: entry.id,
            title: entry.title,
            meta: entry.rating ? `${entry.rating}/5` : entry.status,
          }))}
          label="Recently updated"
        />
      </div>
    );
  }

  if (payload.provider !== "steam") return null;
  return (
    <div className={styles.pattern}>
      <PatternLead
        value={payload.totals.publicGameCount.toLocaleString()}
        label="games in the public library"
        aside={`${payload.totals.totalHoursRounded.toLocaleString()} rounded hours`}
      />
      {payload.playtime?.length ? (
        <Distribution title="Lifetime playtime" entries={payload.playtime} />
      ) : (
        <Distribution
          title="Library state"
          entries={[
            {
              label: "Played",
              count: payload.totals.playedGameCount,
            },
            {
              label: "Unplayed",
              count: Math.max(
                payload.totals.publicGameCount -
                  payload.totals.playedGameCount,
                0,
              ),
            },
          ]}
        />
      )}
      <RecentIndex
        entries={payload.topPlayed.slice(0, 8).map((entry) => ({
          id: entry.appId,
          title: entry.title,
          meta: `${entry.hoursRounded.toLocaleString()}h`,
        }))}
        label="Most played"
      />
    </div>
  );
}
function PatternLead({
  value,
  label,
  aside,
}: {
  value: string;
  label: string;
  aside?: string;
}) {
  return (
    <div className={styles.patternLead} data-stream-item>
      <strong>{value}</strong>
      <span>{label}</span>
      {aside ? <small>{aside}</small> : null}
    </div>
  );
}

function Distribution({
  title,
  entries,
}: {
  title: string;
  entries: StatusCount[];
}) {
  const visible = entries.filter((entry) => entry.count > 0).slice(0, 10);
  const maximum = Math.max(...visible.map((entry) => entry.count), 1);
  return (
    <figure className={styles.distribution} data-stream-item>
      <figcaption>{title}</figcaption>
      <ol>
        {visible.map((entry) => (
          <li
            aria-label={`${entry.label}: ${entry.count.toLocaleString()}`}
            key={entry.label}
          >
            <span>{entry.label}</span>
            <i aria-hidden="true">
              <b
                style={
                  {
                    "--share": `${(entry.count / maximum) * 100}%`,
                  } as CSSProperties
                }
              />
            </i>
            <strong>{entry.count.toLocaleString()}</strong>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function RecentIndex({
  label,
  entries,
}: {
  label: string;
  entries: Array<{ id: string; title: string; meta: string }>;
}) {
  return (
    <section className={styles.recentIndex} data-stream-item>
      <h3>{label}</h3>
      <ol>
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{entry.title}</strong>
            <small>{entry.meta}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
