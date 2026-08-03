import styles from "../PersonalStreams.module.css";
import { syncLabel, type ConnectorState } from "./connector-model";

export function PanelHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.panelHeading}>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
export function StreamEmpty<T>({ state }: { state: ConnectorState<T> }) {
  const loading = state.status === "idle" || state.status === "loading";
  return (
    <div className={styles.empty} aria-live="polite">
      <span aria-hidden="true">{loading ? "···" : "○"}</span>
      <p>
        {loading
          ? "Loading the last public snapshot…"
          : state.status === "unavailable"
            ? state.message
            : "This stream has not been published yet."}
      </p>
    </div>
  );
}

export function StreamStatus({
  stale,
  syncedAt,
  profileUrl,
}: {
  stale: boolean;
  syncedAt: string;
  profileUrl: string | null;
}) {
  return (
    <div className={styles.status}>
      <span>{stale ? "Last-known-good snapshot" : "Current public snapshot"}</span>
      <span>{syncLabel(syncedAt)}</span>
      {profileUrl ? (
        <a href={profileUrl} rel="noreferrer" target="_blank">
          Open profile
        </a>
      ) : null}
    </div>
  );
}
