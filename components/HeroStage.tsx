"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CareerChapters } from "@/components/CareerChapters";
import type {
  CareerChapterId,
  ResolvedCareerChapter,
} from "@/lib/career-chapters";
import styles from "./HeroStage.module.css";

type HeroStageProps = {
  chapters: ResolvedCareerChapter[];
  defaultChapterId: CareerChapterId | null;
  canEnhanceWithThree: boolean;
  headline: string;
  summary: string;
};

export function HeroStage({
  chapters,
  defaultChapterId,
  canEnhanceWithThree,
  headline,
  summary,
}: HeroStageProps) {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (
      !hero ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let disposed = false;
    void import("animejs").then(({ animate, stagger }) => {
      if (disposed) return;
      animate(hero.querySelectorAll("[data-name-line]"), {
        opacity: [0, 1],
        translateY: ["0.72em", 0],
        duration: 650,
        delay: stagger(70),
        ease: "out(4)",
      });
      const copy = hero.querySelector("[data-hero-copy]");
      if (copy) {
        animate(copy, {
          opacity: [0, 1],
          translateY: ["0.8rem", 0],
          duration: 520,
          delay: 180,
          ease: "out(4)",
        });
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  return (
    <section className={styles.module} aria-labelledby="home-title">
      <div className={styles.hero} ref={heroRef}>
        <div className={styles.identity}>
          <p>New York · 2021—Now</p>
          <h1 id="home-title" aria-label="Anish Shah">
            <span data-name-line>ANISH</span>
            <span data-name-line>SHAH</span>
          </h1>
        </div>
        <div className={styles.copy} data-hero-copy>
          <p className={styles.headline}>{headline}</p>
          <p className={styles.thesis}>{summary}</p>
          <Link className={styles.action} href="/work">
            Explore my work <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      <CareerChapters
        chapters={chapters}
        defaultChapterId={defaultChapterId}
        canEnhanceWithThree={canEnhanceWithThree}
      />
    </section>
  );
}
