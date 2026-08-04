"use client";

import { animate } from "animejs";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { SITE_COPY } from "@/lib/copy";
import styles from "./HomeIntroduction.module.css";

type HomeIntroductionProps = {
  headline: string;
  summary: string;
};

export function HomeIntroduction({
  headline,
  summary,
}: HomeIntroductionProps) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (
      !root ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const animations: Array<ReturnType<typeof animate>> = [];
    const copy = root.querySelector("[data-intro-copy]");
    if (copy) {
      animations.push(
        animate(copy, {
          translateY: ["0.25rem", 0],
          duration: 400,
          delay: 110,
          ease: "out(4)",
        }),
      );
    }

    return () => {
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  return (
    <section
      id="profile"
      className={styles.introduction}
      aria-labelledby="home-title"
      ref={rootRef}
    >
      <div className={styles.identity}>
        <p>{SITE_COPY.home["identity-eyebrow"]}</p>
        <h1 id="home-title" aria-label="Anish Shah">
          <span>Anish</span>
          <span>Shah</span>
        </h1>
      </div>
      <div className={styles.copy} data-intro-copy>
        <p className={styles.headline}>{headline}</p>
        <p className={styles.summary}>{summary}</p>
        <Link className={styles.action} href="/work">
          {SITE_COPY.home["primary-cta"]} <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}
