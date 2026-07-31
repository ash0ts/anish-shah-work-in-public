"use client";

import { animate, stagger } from "animejs";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import {
  workGroupPeriodLabel,
  type featuredWorkBucketsFrom,
} from "@/lib/work-groups";
import styles from "./BodiesOfWork.module.css";

type FeaturedBuckets = ReturnType<typeof featuredWorkBucketsFrom>;

export function BodiesOfWork({ buckets }: { buckets: FeaturedBuckets }) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (
      !root ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const activeAnimations = new Map<
      HTMLDetailsElement,
      Array<ReturnType<typeof animate>>
    >();
    const details = Array.from(
      root.querySelectorAll<HTMLDetailsElement>("details[data-bucket]"),
    );
    const cancelFor = (detail: HTMLDetailsElement) => {
      activeAnimations.get(detail)?.forEach((animation) => animation.cancel());
      activeAnimations.delete(detail);
    };
    const onToggle = (event: Event) => {
      const detail = event.currentTarget as HTMLDetailsElement;
      cancelFor(detail);
      if (!detail.open) return;

      const body = detail.querySelector<HTMLElement>("[data-bucket-body]");
      const rows = detail.querySelectorAll("[data-work-row]");
      const animations: Array<ReturnType<typeof animate>> = [];
      if (body) {
        animations.push(
          animate(body, {
            opacity: [0.84, 1],
            translateY: ["0.3rem", 0],
            duration: 280,
            ease: "out(4)",
          }),
        );
      }
      if (rows.length) {
        animations.push(
          animate(rows, {
            translateX: ["0.25rem", 0],
            duration: 320,
            delay: stagger(38),
            ease: "out(4)",
          }),
        );
      }
      activeAnimations.set(detail, animations);
    };

    details.forEach((detail) => detail.addEventListener("toggle", onToggle));
    return () => {
      details.forEach((detail) => {
        detail.removeEventListener("toggle", onToggle);
        cancelFor(detail);
      });
    };
  }, []);

  return (
    <section
      className={styles.section}
      aria-labelledby="bodies-of-work-title"
      ref={rootRef}
    >
      <header className={styles.heading}>
        <div>
          <p>Selected technical work</p>
          <h2 id="bodies-of-work-title">
            Systems, curricula, writing, and technical sessions.
          </h2>
        </div>
        <p>
          Representative projects, organized by how the work was built,
          taught, documented, or delivered.
        </p>
      </header>

      <div className={styles.bucketList}>
        {buckets.map((bucket, index) => {
          const years = bucket.groups.flatMap((group) =>
            [group.yearStart, group.yearEnd].filter(
              (year): year is number => year !== null,
            ),
          );
          const period = years.length
            ? `${Math.min(...years)}—${String(Math.max(...years)).slice(-2)}`
            : "Public index";
          return (
            <details
              className={styles.bucket}
              data-bucket={bucket.id}
              key={bucket.id}
              open={index === 0}
            >
              <summary>
                <h3>{bucket.title}</h3>
                <small>{period}</small>
                <i aria-hidden="true">+</i>
              </summary>
              <div className={styles.bucketBody} data-bucket-body>
                <p>{bucket.statement}</p>
                <ol>
                  {bucket.groups.map((group) => (
                    <li data-work-row key={group.id}>
                      <Link href={`/work/${group.slug}`} prefetch={false}>
                        <span>
                          {workGroupPeriodLabel(group)} · {group.homeRole}
                        </span>
                        <strong>{group.homeTitle}</strong>
                        <i aria-hidden="true">↗</i>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          );
        })}
      </div>

      <Link className={styles.indexLink} href="/work">
        Open the complete work index <span aria-hidden="true">↗</span>
      </Link>
    </section>
  );
}
