"use client";

import { useEffect } from "react";

export function WorkFilterBehavior({
  filtersId,
  moreFiltersId,
}: {
  filtersId: string;
  moreFiltersId: string;
}) {
  useEffect(() => {
    const filters = document.getElementById(filtersId);
    const moreFilters = document.getElementById(moreFiltersId);
    if (
      !(filters instanceof HTMLDetailsElement) ||
      !(moreFilters instanceof HTMLDetailsElement)
    ) {
      return;
    }

    const desktop = window.matchMedia("(min-width: 901px)");
    const syncDefault = () => {
      filters.open = desktop.matches;
      moreFilters.open = !desktop.matches;
    };
    syncDefault();
    desktop.addEventListener("change", syncDefault);
    return () => desktop.removeEventListener("change", syncDefault);
  }, [filtersId, moreFiltersId]);

  return null;
}
