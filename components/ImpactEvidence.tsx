import Link from "next/link";
import type { HomepageImpactTrack } from "@/lib/home-impact";
import styles from "./ImpactEvidence.module.css";

export function ImpactEvidence({ tracks }: { tracks: HomepageImpactTrack[] }) {
  return (
    <section className={styles.section} aria-labelledby="impact-title">
      <header className={styles.heading}>
        <div>
          <p>Proof, with limits</p>
          <h2 id="impact-title">What happened after the work shipped.</h2>
        </div>
        <p>
          Three independent measures; no shared scale.{" "}
          <Link href="/sources#internal-analytics" prefetch={false}>
            See how I count ↗
          </Link>
        </p>
      </header>

      <ol className={styles.proofs}>
        {tracks.map((track) => {
          const datum = track.metrics[0];
          if (!datum) return null;
          return (
            <li data-impact-track={track.id} data-proof-row key={track.id}>
              <span>{track.label}</span>
              <Link href={`/sources#${datum.metric.id}`} prefetch={false}>
                <strong>{datum.metric.displayValue}</strong>
                <small>{datum.shortLabel}</small>
              </Link>
              <div>
                <h3>{track.statement}</h3>
                <p>{track.qualifier}</p>
                <small>
                  {track.periodLabel} · {humanize(datum.metric.scope)} ·{" "}
                  {humanize(datum.metric.attribution)} · {datum.metric.sourceLabel}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
