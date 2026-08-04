"use client";

import { useEffect } from "react";

export function WorkBodyBehavior() {
  useEffect(() => {
    const bodies = Array.from(
      document.querySelectorAll<HTMLDetailsElement>(
        "#work-index details[data-work-body]",
      ),
    );
    if (!bodies.length) return;

    const desktop = window.matchMedia("(min-width: 761px)");
    const syncDefaults = () => {
      if (!desktop.matches) {
        for (const body of bodies) body.open = false;
        return;
      }

      const explicitlyOpen = bodies.filter(
        (body) => body.dataset.defaultOpen === "true",
      );
      const defaults = explicitlyOpen.length ? explicitlyOpen : [bodies[0]];
      for (const body of bodies) body.open = defaults.includes(body);
    };

    syncDefaults();
    desktop.addEventListener("change", syncDefaults);
    return () => desktop.removeEventListener("change", syncDefaults);
  }, []);

  return null;
}
