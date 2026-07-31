"use client";

import { animate, stagger } from "animejs";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import type { HomepageImpactTrack } from "@/lib/home-impact";
import styles from "./ImpactEvidence.module.css";

export function ImpactEvidence({
  tracks,
}: {
  tracks: HomepageImpactTrack[];
}) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (
      !root ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const lines = root.querySelectorAll<HTMLElement>("[data-signal-line]");
    const markers = root.querySelectorAll<HTMLElement>("[data-signal-marker]");
    let lineAnimation: ReturnType<typeof animate> | undefined;
    let markerAnimation: ReturnType<typeof animate> | undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        lineAnimation = animate(lines, {
          scaleX: [0, 1],
          duration: 560,
          delay: stagger(70),
          ease: "out(4)",
        });
        markerAnimation = animate(markers, {
          translateY: ["0.25rem", 0],
          duration: 360,
          delay: stagger(42, { start: 120 }),
          ease: "out(4)",
        });
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(root);
    return () => {
      observer.disconnect();
      lineAnimation?.cancel();
      markerAnimation?.cancel();
    };
  }, []);

  return (
    <section
      className={styles.section}
      aria-labelledby="impact-title"
      ref={rootRef}
    >
      <header className={styles.heading}>
        <div>
          <p>Evidence beyond the demo</p>
          <h2 id="impact-title">Use. Return. Act.</h2>
        </div>
        <p>
          Independent measures · no shared scale.{" "}
          <Link href="/sources#internal-analytics">How measured ↗</Link>
        </p>
      </header>

      <ol className={styles.trackList}>
        {tracks.map((track) => (
          <li
            className={styles.track}
            data-impact-track={track.id}
            key={track.id}
          >
            <header>
              <span>{track.label}</span>
              <h3>{track.statement}</h3>
              <small>{track.periodLabel}</small>
            </header>

            <div className={styles.plot}>
              <span
                className={styles.signalLine}
                data-signal-line
                aria-hidden="true"
              />
              <ol>
                {track.metrics.map(({ metric, shortLabel }) => (
                  <li data-signal-marker key={metric.id}>
                    <Link
                      href={`/sources#${metric.id}`}
                      aria-label={`${metric.displayValue} ${metric.label}. ${metric.qualifier}`}
                    >
                      <strong>{metric.displayValue}</strong>
                      <span>{shortLabel}</span>
                      <small>
                        {metric.period.asOf
                          ? `checkpoint ${formatDate(metric.period.asOf)}`
                          : metric.period.label}
                      </small>
                    </Link>
                  </li>
                ))}
              </ol>
              {track.id === "deployed" ? (
                <div className={styles.returnMark} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              ) : null}
              {track.id === "taught" ? (
                <div className={styles.associationMark} aria-hidden="true">
                  <i />
                  <i />
                </div>
              ) : null}
              {track.id === "programs" ? (
                <div className={styles.programSpan} aria-hidden="true">
                  <span>2024</span>
                  <i />
                  <span>2025</span>
                </div>
              ) : null}
            </div>

            <p className={styles.qualifier}>
              <span>Limit</span> {track.qualifier}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
