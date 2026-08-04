import styles from "../PersonalStreams.module.css";
import { syncLabel, type ConnectorState } from "./connector-model";
import { SITE_COPY } from "@/lib/copy";

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
          ? SITE_COPY.play["loading-collection"]
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
  profileLabel,
}: {
  stale: boolean;
  syncedAt: string;
  profileUrl: string | null;
  profileLabel: string;
}) {
  return (
    <div className={styles.status}>
      {stale ? <span>{SITE_COPY.play["status-stale"]}</span> : null}
      <span>{syncLabel(syncedAt)}</span>
      {profileUrl ? (
        <a href={profileUrl} rel="noreferrer" target="_blank">
          {profileLabel}
        </a>
      ) : null}
    </div>
  );
}
