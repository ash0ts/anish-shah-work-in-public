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
          <span>{SITE_COPY.home["impact-method-label"]}</span>
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
                    <i aria-hidden="true">+</i>
                  </summary>
                  <div className={styles.signalDetail}>
                    <p>{track.explanation}</p>
                    <p className={styles.reviewDate}>{track.periodLabel}</p>
                    <Link
                      href={`/sources#${datum.metric.id}`}
                      prefetch={false}
                    >
                      {SITE_COPY.home["impact-source-cta"]}{" "}
                      <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </details>
                {track.supportingMetrics.length ? (
                  <div className={styles.supporting} data-mcp-supporting-metrics>
                    <p>{SITE_COPY.home["impact-supporting-provenance"]}</p>
                    <ul>
                      {track.supportingMetrics.map((metric) => (
                        <li key={metric.id}>
                          <Link href={`/sources#${metric.id}`} prefetch={false}>
                            <strong>{metric.displayValue}</strong> {metric.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <figcaption>{SITE_COPY.home["impact-summary"]}</figcaption>
      </figure>
    </section>
  );
}
