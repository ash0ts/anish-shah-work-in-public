"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WorkTimeline.module.css";

type WorkTimelineControlsProps = {
  availableYears: number[];
  frameId: string;
  initialYear: number;
  years: readonly number[];
};

export function WorkTimelineControls({
  availableYears,
  frameId,
  initialYear,
  years,
}: WorkTimelineControlsProps) {
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const controlsRef = useRef<HTMLDivElement>(null);
  const selectedYearRef = useRef(initialYear);

  useEffect(() => {
    const frame = document.getElementById(frameId);
    if (!(frame instanceof HTMLElement)) return;

    const mobile = window.matchMedia("(max-width: 760px)");
    let animationFrame = 0;

    const headerForYear = (year: number) =>
      frame.querySelector<HTMLElement>(`[data-timeline-year="${year}"]`);

    const stickyColumnWidth = () =>
      frame.querySelector<HTMLElement>("thead th:first-child")
        ?.getBoundingClientRect().width ?? 0;

    const nearestYear = () => {
      if (!mobile.matches) return;
      const target = frame.scrollLeft + stickyColumnWidth();
      const nextYear = years.reduce((nearest, year) => {
        const nearestHeader = headerForYear(nearest);
        const candidateHeader = headerForYear(year);
        if (!nearestHeader || !candidateHeader) return nearest;
        return Math.abs(candidateHeader.offsetLeft - target) <
          Math.abs(nearestHeader.offsetLeft - target)
          ? year
          : nearest;
      }, selectedYearRef.current);
      if (nextYear !== selectedYearRef.current) {
        selectedYearRef.current = nextYear;
        setSelectedYear(nextYear);
        centerYearControl(controlsRef.current, nextYear, false);
      }
    };

    const onScroll = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(nearestYear);
    };

    frame.addEventListener("scroll", onScroll, { passive: true });

    const start = window.requestAnimationFrame(() => {
      if (mobile.matches) {
        scrollToYear(frame, headerForYear(initialYear), false);
        centerYearControl(controlsRef.current, initialYear, false);
        nearestYear();
      }
      if (controlsRef.current) controlsRef.current.dataset.ready = "true";
    });

    const syncMobileMode = () => {
      if (!mobile.matches) return;
      window.requestAnimationFrame(() => {
        scrollToYear(frame, headerForYear(selectedYearRef.current), false);
        centerYearControl(
          controlsRef.current,
          selectedYearRef.current,
          false,
        );
        nearestYear();
      });
    };
    mobile.addEventListener("change", syncMobileMode);

    return () => {
      frame.removeEventListener("scroll", onScroll);
      mobile.removeEventListener("change", syncMobileMode);
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(start);
    };
  }, [frameId, initialYear, years]);

  const selectYear = (year: number) => {
    const frame = document.getElementById(frameId);
    const header = frame?.querySelector<HTMLElement>(
      `[data-timeline-year="${year}"]`,
    );
    if (!(frame instanceof HTMLElement) || !header) return;
    selectedYearRef.current = year;
    setSelectedYear(year);
    scrollToYear(frame, header, true);
    centerYearControl(controlsRef.current, year, true);
  };

  const selectedIndex = years.indexOf(selectedYear);
  const previousYear = years[Math.max(0, selectedIndex - 1)];
  const nextYear = years[Math.min(years.length - 1, selectedIndex + 1)];

  return (
    <div
      aria-label="Choose a year to view in the work calendar"
      className={styles.yearControls}
      ref={controlsRef}
      role="group"
    >
      <button
        aria-label="Show previous year"
        disabled={selectedIndex <= 0}
        onClick={() => selectYear(previousYear ?? selectedYear)}
        type="button"
      >
        <span aria-hidden="true">←</span>
      </button>
      <div className={styles.yearRail} data-year-rail>
        {years.map((year) => (
          <button
            aria-pressed={selectedYear === year}
            className={
              availableYears.includes(year) ? undefined : styles.yearEmpty
            }
            data-work-year={year}
            key={year}
            onClick={() => selectYear(year)}
            type="button"
          >
            {year}
          </button>
        ))}
      </div>
      <button
        aria-label="Show next year"
        disabled={selectedIndex >= years.length - 1}
        onClick={() => selectYear(nextYear ?? selectedYear)}
        type="button"
      >
        <span aria-hidden="true">→</span>
      </button>
      <span aria-atomic="true" aria-live="polite" className={styles.yearStatus}>
        Showing {selectedYear}
      </span>
    </div>
  );
}

function centerYearControl(
  controls: HTMLElement | null,
  year: number,
  animate: boolean,
) {
  const rail = controls?.querySelector<HTMLElement>("[data-year-rail]");
  const button = controls?.querySelector<HTMLElement>(
    `[data-work-year="${year}"]`,
  );
  if (!rail || !button) return;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const railBounds = rail.getBoundingClientRect();
  const buttonBounds = button.getBoundingClientRect();
  const buttonLeftInScrollContent =
    rail.scrollLeft + buttonBounds.left - railBounds.left;
  rail.scrollTo({
    behavior: animate && !reduceMotion ? "smooth" : "auto",
    left: Math.max(
      0,
      buttonLeftInScrollContent -
        (rail.clientWidth - buttonBounds.width) / 2,
    ),
  });
}

function scrollToYear(
  frame: HTMLElement,
  header: HTMLElement | null,
  animate: boolean,
) {
  if (!header) return;
  const stickyColumn = frame.querySelector<HTMLElement>(
    "thead th:first-child",
  );
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  frame.scrollTo({
    behavior: animate && !reduceMotion ? "smooth" : "auto",
    left: Math.max(0, header.offsetLeft - (stickyColumn?.offsetWidth ?? 0)),
  });
}
