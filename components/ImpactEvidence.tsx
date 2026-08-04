"use client";

import { animate, stagger } from "animejs";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import type { HomepageImpactTrack } from "@/lib/home-impact";
import styles from "./ImpactEvidence.module.css";

export function ImpactEvidence({ tracks }: { tracks: HomepageImpactTrack[] }) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const rows = root.querySelectorAll<HTMLElement>("[data-proof-row]");
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      animate(rows, {
        opacity: [0.7, 1],
        translateY: ["0.25rem", 0],
        duration: 340,
        delay: stagger(55),
        ease: "out(4)",
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <section className={styles.section} aria-labelledby="impact-title" ref={rootRef}>
      <header className={styles.heading}>
        <div>
          <p>Proof, with limits</p>
          <h2 id="impact-title">What happened after the work shipped.</h2>
        </div>
        <p>
          Three independent measures; no shared scale.{" "}
          <Link href="/sources#internal-analytics">See how I count ↗</Link>
        </p>
      </header>

      <ol className={styles.proofs}>
        {tracks.map((track) => {
          const datum = track.metrics[0];
          if (!datum) return null;
          return (
            <li data-impact-track={track.id} data-proof-row key={track.id}>
              <span>{track.label}</span>
              <Link href={`/sources#${datum.metric.id}`}>
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
