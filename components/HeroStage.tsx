"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  LivingWorkIndex,
  type WorkIndexEntry,
} from "@/components/LivingWorkIndex";

type HeroStageProps = {
  entries: WorkIndexEntry[];
  headline: string;
  summary: string;
};

export function HeroStage({ entries, headline, summary }: HeroStageProps) {
  const stageRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) return;

    let cancelled = false;
    void import("animejs").then(({ animate, stagger }) => {
      if (cancelled) return;
      animate(stage.querySelectorAll("[data-hero-line]"), {
        opacity: [0, 1],
        translateY: ["1.4rem", 0],
        duration: 720,
        delay: stagger(85),
        ease: "out(4)",
      });
      const index = stage.querySelector("[data-hero-index]");
      if (index) {
        animate(index, {
          opacity: [0, 1],
          translateX: ["1.2rem", 0],
          duration: 760,
          delay: 230,
          ease: "out(4)",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const tuneName = (event: React.PointerEvent<HTMLElement>) => {
    const name = nameRef.current;
    const stage = stageRef.current;
    if (!name || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    name.style.setProperty("--hero-casl", (0.42 + x * 0.5).toFixed(2));
    name.style.setProperty("--hero-mono", (0.06 + y * 0.2).toFixed(2));
    name.style.setProperty("--hero-slnt", String(Math.round(-3 - x * 7)));
  };

  return (
    <section className="v11-hero" ref={stageRef} onPointerMove={tuneName}>
      <div className="v11-hero-copy">
        <div className="v11-hero-meta" data-hero-line>
          <span>{headline}</span>
          <span>New York · 2021—now</span>
        </div>

        <h1 ref={nameRef} data-hero-line aria-label="Anish Shah">
          <span>ANISH</span>
          <span>SHAH</span>
        </h1>

        <div className="v11-hero-thesis" data-hero-line>
          <p>{summary}</p>
          <div>
            <Link className="primary-action" href="/work">
              Explore my work <span aria-hidden="true">↗</span>
            </Link>
            <Link className="text-action" href="/about">
              About the practice
            </Link>
          </div>
        </div>
      </div>

      <div className="v11-hero-index" data-hero-index>
        <LivingWorkIndex entries={entries} autoLoadDesktop />
      </div>
    </section>
  );
}
