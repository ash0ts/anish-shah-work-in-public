import Link from "next/link";
import { HomeSignalIcon } from "@/components/HomeVisualIcons";
import { SITE_COPY } from "@/lib/copy";
import type { HomepageImpactTrack } from "@/lib/home-impact";
import styles from "./ImpactEvidence.module.css";

export function ImpactEvidence({ tracks }: { tracks: HomepageImpactTrack[] }) {
  return (
    <section className={styles.section} aria-labelledby="impact-title">
      <header className={styles.heading}>
        <h2 id="impact-title">{SITE_COPY.home["impact-heading"]}</h2>
      </header>

      <figure className={styles.figure} data-signal-circuit>
        <Link
          className={styles.hub}
          href="/sources#internal-analytics"
          prefetch={false}
        >
          <span>Method</span>
          <i aria-hidden="true">↗</i>
        </Link>

        <ol className={styles.signals}>
          {tracks.map((track) => {
            const datum = track.metrics[0];
            if (!datum) return null;
            return (
              <li data-impact-track={track.id} key={track.id}>
                <details className={styles.signal} name="home-signal">
                  <summary>
                    <HomeSignalIcon
                      className={styles.signalIcon}
                      iconId={track.iconId}
                    />
                    <strong>{datum.metric.displayValue}</strong>
                    <span>{track.label}</span>
                    <small>{track.compactLimit}</small>
                    <i aria-hidden="true">+</i>
                  </summary>
                  <div className={styles.signalDetail}>
                    <p>{track.qualifier}</p>
                    <dl>
                      <div>
                        <dt>Period</dt>
                        <dd>
                          {track.periodLabel}
                          {track.periodAsOf
                            ? ` · as of ${track.periodAsOf}`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Scope</dt>
                        <dd>{humanize(datum.metric.scope)}</dd>
                      </div>
                      <div>
                        <dt>Attribution</dt>
                        <dd>{humanize(datum.metric.attribution)}</dd>
                      </div>
                    </dl>
                    <Link
                      href={`/sources#${datum.metric.id}`}
                      prefetch={false}
                    >
                      {datum.metric.sourceLabel}{" "}
                      <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        <figcaption>{SITE_COPY.home["impact-summary"]}</figcaption>
      </figure>
    </section>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
