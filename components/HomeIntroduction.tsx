"use client";

import { animate, stagger } from "animejs";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import styles from "./HomeIntroduction.module.css";

type HomeIntroductionProps = {
  headline: string;
  summary: string;
};

const trajectory = [
  ["2021", "Operational ML"],
  ["2022—23", "Generative systems"],
  ["2024—25", "Evaluation & adoption"],
  ["Now", "Agent-native product"],
] as const;

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

    const animations = [
      animate(root.querySelectorAll("[data-name-line]"), {
        translateY: ["0.2em", 0],
        duration: 520,
        delay: stagger(55),
        ease: "out(4)",
      }),
    ];
    const copy = root.querySelector("[data-intro-copy]");
    if (copy) {
      animations.push(
        animate(copy, {
          translateY: ["0.35rem", 0],
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
        <p>Applied AI · New York · 2021—Now</p>
        <h1 id="home-title" aria-label="Anish Shah">
          <span data-name-line>Anish</span>
          <span data-name-line>Shah</span>
        </h1>
      </div>
      <div className={styles.copy} data-intro-copy>
        <p className={styles.headline}>{headline}</p>
        <p className={styles.summary}>{summary}</p>
        <p className={styles.focus}>
          <span>Now</span>
          How agents discover tools, use context, and leave evidence teams can
          trust.
        </p>
        <Link className={styles.action} href="/work">
          Explore my work <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <ol className={styles.trajectory} aria-label="Career trajectory">
        {trajectory.map(([period, title]) => (
          <li key={period}>
            <span>{period}</span>
            <strong>{title}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
