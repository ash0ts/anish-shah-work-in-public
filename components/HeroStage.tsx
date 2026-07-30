"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PortfolioItem } from "@/types/content";

type HeroStageProps = {
  items: PortfolioItem[];
  headline: string;
  summary: string;
};

type RibbonAnimation = {
  cancel(): unknown;
  pause(): unknown;
  resume(): unknown;
};

export function HeroStage({ items, headline, summary }: HeroStageProps) {
  const stageRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<RibbonAnimation | null>(null);
  const pausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    const name = nameRef.current;
    const track = trackRef.current;
    if (!stage || !name || !track) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      pausedRef.current = true;
      return;
    }

    let cancelled = false;
    let cleanupTicker: (() => void) | undefined;

    void import("animejs").then(({ animate, stagger }) => {
      if (cancelled) return;
      animate(stage.querySelectorAll("[data-hero-reveal]"), {
        opacity: [0, 1],
        translateY: [28, 0],
        duration: 900,
        delay: stagger(95),
        ease: "out(4)",
      });
      const ticker = animate(track, {
        translateX: ["0%", "-50%"],
        duration: 38000,
        loop: true,
        ease: "linear",
      });
      tickerRef.current = ticker;
      if (pausedRef.current) ticker.pause();
      cleanupTicker = () => {
        tickerRef.current = null;
        ticker.cancel();
      };
    });

    let frame = 0;
    const updateAxes = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = stage.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
        name.style.setProperty("--hero-casl", (0.25 + x * 0.75).toFixed(2));
        name.style.setProperty("--hero-mono", (y * 0.68).toFixed(2));
        name.style.setProperty("--hero-slnt", String(Math.round(-2 - x * 10)));
      });
    };
    stage.addEventListener("pointermove", updateAxes, { passive: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cleanupTicker?.();
      stage.removeEventListener("pointermove", updateAxes);
    };
  }, []);

  const toggleTicker = () => {
    const nextPaused = !pausedRef.current;
    pausedRef.current = nextPaused;
    setIsPaused(nextPaused);
    if (nextPaused) tickerRef.current?.pause();
    else tickerRef.current?.resume();
  };

  return (
    <section className="hero-stage" ref={stageRef}>
      <div className="hero-topline" data-hero-reveal>
        <p>{headline}</p>
        <p>
          New York <span aria-hidden="true">↘</span> 2021—Now
        </p>
      </div>

      <h1 className="hero-name" ref={nameRef} aria-label="Anish Shah">
        <span>ANISH</span>
        <span>SHAH</span>
      </h1>

      <div className="work-ribbon-wrap">
        <div className="work-ribbon" aria-label="Selected work index">
          <div className="work-ribbon-track" ref={trackRef}>
            <div className="work-ribbon-sequence">
              {items.map((item) => (
                <span className="ribbon-entry" key={item.id}>
                  <b>{item.year ?? "Now"}</b>
                  <span>{item.title}</span>
                  <i aria-hidden="true">✳</i>
                </span>
              ))}
            </div>
            <div className="work-ribbon-sequence" aria-hidden="true">
              {items.map((item) => (
                <span className="ribbon-entry" key={`repeat-${item.id}`}>
                  <b>{item.year ?? "Now"}</b>
                  <span>{item.title}</span>
                  <i aria-hidden="true">✳</i>
                </span>
              ))}
            </div>
          </div>
        </div>
        <button
          className="ribbon-motion-toggle"
          type="button"
          aria-pressed={isPaused}
          onClick={toggleTicker}
        >
          {isPaused ? "Play index" : "Pause index"}
        </button>
      </div>

      <div className="hero-close" data-hero-reveal>
        <p>{summary}</p>
        <div className="hero-actions">
          <Link className="primary-action" href="/work">
            Explore my work <span aria-hidden="true">↗</span>
          </Link>
          <Link className="text-action" href="/about">
            How I work
          </Link>
        </div>
      </div>
      <p className="motion-note" data-hero-reveal>
        Move across the name. The letterforms respond.
      </p>
    </section>
  );
}
