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

    const start = window.requestAnimationFrame(() => {
      if (controlsRef.current) controlsRef.current.dataset.ready = "true";
      if (mobile.matches) {
        setMobileYearPresentation(frame, initialYear);
        centerYearControl(controlsRef.current, initialYear, false);
      }
    });

    const syncMobileMode = () => {
      window.requestAnimationFrame(() => {
        if (!mobile.matches) {
          restoreFullCalendar(frame);
          return;
        }
        setMobileYearPresentation(frame, selectedYearRef.current);
        centerYearControl(
          controlsRef.current,
          selectedYearRef.current,
          false,
        );
      });
    };
    mobile.addEventListener("change", syncMobileMode);

    return () => {
      mobile.removeEventListener("change", syncMobileMode);
      window.cancelAnimationFrame(start);
      restoreFullCalendar(frame);
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
    if (window.matchMedia("(max-width: 760px)").matches) {
      setMobileYearPresentation(frame, year);
    }
    centerYearControl(controlsRef.current, year, false);
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

function setMobileYearPresentation(frame: HTMLElement, year: number) {
  frame.dataset.mobileYear = String(year);
  frame.setAttribute(
    "aria-label",
    `Work timeline table. Showing ${year}. Use the year controls to compare years.`,
  );
  for (const cell of frame.querySelectorAll<HTMLElement>(
    "[data-timeline-year], [data-year]",
  )) {
    const cellYear = Number(
      cell.dataset.timelineYear ?? cell.dataset.year,
    );
    cell.hidden = cellYear !== year;
  }
  frame.scrollLeft = 0;
}

function restoreFullCalendar(frame: HTMLElement) {
  delete frame.dataset.mobileYear;
  frame.setAttribute(
    "aria-label",
    "Work timeline table. Scroll horizontally to compare years.",
  );
  for (const cell of frame.querySelectorAll<HTMLElement>(
    "[data-timeline-year], [data-year]",
  )) {
    cell.hidden = false;
  }
}
