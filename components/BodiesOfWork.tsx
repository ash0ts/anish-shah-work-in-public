"use client";

import { animate, stagger } from "animejs";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import {
  workGroupPeriodLabel,
  type featuredWorkBucketsFrom,
} from "@/lib/work-groups";
import { SITE_COPY } from "@/lib/copy";
import styles from "./BodiesOfWork.module.css";

type FeaturedBuckets = ReturnType<typeof featuredWorkBucketsFrom>;

export function BodiesOfWork({ buckets }: { buckets: FeaturedBuckets }) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const rows = root.querySelectorAll<HTMLElement>("[data-work-line]");
    let motion: { cancel: () => void } | null = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      motion = animate(rows, {
        opacity: [0.72, 1],
        translateY: ["0.3rem", 0],
        duration: 320,
        delay: stagger(45),
        ease: "out(4)",
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    observer.observe(root);
    return () => {
      observer.disconnect();
      motion?.cancel();
    };
  }, []);

  return (
    <section
      className={styles.section}
      aria-labelledby="lines-of-work-title"
      ref={rootRef}
    >
      <header className={styles.heading}>
        <p>{SITE_COPY.home["selected-eyebrow"]}</p>
        <h2 id="lines-of-work-title">{SITE_COPY.home["selected-heading"]}</h2>
      </header>

      <ol className={styles.lines}>
        {buckets.flatMap((bucket) => {
          const group = bucket.groups[0];
          if (!group) return [];
          return [
            <li data-work-line data-bucket={bucket.id} key={bucket.id}>
              <h3>{bucket.title}</h3>
              <Link href={`/work/${group.slug}`} prefetch={false}>
                <span>{workGroupPeriodLabel(group)} · {group.homeRole}</span>
                <strong>{group.homeTitle}</strong>
                <i aria-hidden="true">↗</i>
              </Link>
            </li>,
          ];
        })}
      </ol>
    </section>
  );
}
