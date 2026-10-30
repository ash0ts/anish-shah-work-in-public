"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import styles from "./work.module.css";
import { SITE_COPY } from "@/lib/copy";

type FilterOption = {
  count: number;
  label: string;
  value: string;
};

type WorkMobileFiltersProps = {
  activeFilterCount: number;
  fallbackFiltersId: string;
  formId: string;
  options: {
    buckets: FilterOption[];
    formats: FilterOption[];
  };
  query: {
    bucket: string;
    format: string;
    organization: string;
    practice: string;
    query: string;
    role: string;
    topic: string;
    year: string;
  };
};

export function WorkMobileFilters({
  activeFilterCount,
  fallbackFiltersId,
  formId,
  options,
  query,
}: WorkMobileFiltersProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const primaryValueRefs = useRef<
    Record<"q" | "topic" | "year", HTMLInputElement | null>
  >({ q: null, topic: null, year: null });
  const bucketRef = useRef<HTMLSelectElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const headingId = useId();

  useEffect(() => {
    const filters = document.getElementById(fallbackFiltersId);
    const supported =
      filters instanceof HTMLDetailsElement &&
      typeof HTMLDialogElement !== "undefined" &&
      typeof HTMLDialogElement.prototype.showModal === "function";
    if (!supported) return;
    filters.dataset.mobileDialog = "true";
    if (rootRef.current) rootRef.current.dataset.ready = "true";
    return () => {
      delete filters.dataset.mobileDialog;
    };
  }, [fallbackFiltersId]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => {
      if (desktop.matches && dialogRef.current?.open) {
        dialogRef.current.close();
      }
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const openDialog = () => {
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) {
      for (const name of ["q", "topic", "year"] as const) {
        const source = form.elements.namedItem(name);
        const destination = primaryValueRefs.current[name];
        if (
          destination &&
          (source instanceof HTMLInputElement ||
            source instanceof HTMLSelectElement)
        ) {
          destination.value = source.value;
        }
      }
      for (const [name, ref] of [["bucket", bucketRef], ["format", formatRef]] as const) {
        const source = form.elements.namedItem(name);
        if (source instanceof HTMLSelectElement && ref.current) ref.current.value = source.value;
      }
    }
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };

  return (
    <div className={styles.mobileFilters} ref={rootRef}>
      <button
        aria-haspopup="dialog"
        className={styles.mobileFilterTrigger}
        onClick={openDialog}
        ref={triggerRef}
        type="button"
      >
        Filters
        {activeFilterCount ? <span>{activeFilterCount}</span> : null}
      </button>
      <dialog
        aria-labelledby={headingId}
        className={styles.mobileFilterDialog}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog();
        }}
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <div className={styles.mobileFilterSheet}>
          <header>
            <div>
              <p>Work index</p>
              <h2 id={headingId}>Filter the calendar</h2>
            </div>
            <button aria-label="Close filters" onClick={closeDialog} type="button">
              ×
            </button>
          </header>
          <form action="/work#work-index" method="get">
            <input
              defaultValue={query.query}
              name="q"
              ref={(node) => {
                primaryValueRefs.current.q = node;
              }}
              type="hidden"
            />
            <input
              defaultValue={query.topic}
              name="topic"
              ref={(node) => {
                primaryValueRefs.current.topic = node;
              }}
              type="hidden"
            />
            <input
              defaultValue={query.year}
              name="year"
              ref={(node) => {
                primaryValueRefs.current.year = node;
              }}
              type="hidden"
            />
            {query.practice ? (
              <input name="practice" type="hidden" value={query.practice} />
            ) : null}
            {query.organization ? (
              <input name="organization" type="hidden" value={query.organization} />
            ) : null}
            {query.role ? (
              <input name="role" type="hidden" value={query.role} />
            ) : null}
            <MobileFilterSelect
              allLabel={SITE_COPY.work["filter-all-types"]}
              label={SITE_COPY.work["filter-work-type"]}
              name="bucket"
              options={options.buckets}
              value={query.bucket}
              selectRef={bucketRef}
            />
            <MobileFilterSelect
              allLabel="All formats"
              label="Format"
              name="format"
              options={options.formats}
              value={query.format}
              selectRef={formatRef}
            />
            <div className={styles.mobileFilterActions}>
              <button type="submit">Show work</button>
              <LinkClear />
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}

function MobileFilterSelect({
  allLabel,
  label,
  name,
  options,
  value,
  selectRef,
}: {
  allLabel: string;
  label: string;
  name: string;
  options: FilterOption[];
  value: string;
  selectRef?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <label className={styles.mobileSelect}>
      <span>{label}</span>
      <select defaultValue={value} name={name} ref={selectRef}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} · {option.count}
          </option>
        ))}
      </select>
    </label>
  );
}

function LinkClear() {
  return (
    <Link className={styles.mobileClear} href="/work" prefetch={false}>
      Clear all
    </Link>
  );
}
