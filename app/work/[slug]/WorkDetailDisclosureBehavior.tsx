"use client";

import { useLayoutEffect } from "react";

export function WorkDetailDisclosureBehavior() {
  useLayoutEffect(() => {
    const mobile = window.matchMedia("(max-width: 760px)");
    const disclosures = Array.from(
      document.querySelectorAll<HTMLDetailsElement>(
        "details[data-supporting-disclosure]",
      ),
    );

    const revealFragment = () => {
      let fragment = window.location.hash.slice(1);
      if (!fragment) return;
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        return;
      }
      const target = document.getElementById(fragment);
      const disclosure = target?.closest<HTMLDetailsElement>(
        "details[data-supporting-disclosure]",
      );
      if (!target || !disclosure) return;
      disclosure.open = true;
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "start" });
      });
    };

    const syncDisclosureMode = () => {
      for (const disclosure of disclosures) {
        disclosure.open = !mobile.matches;
      }
      revealFragment();
    };

    syncDisclosureMode();
    window.addEventListener("hashchange", revealFragment);
    mobile.addEventListener("change", syncDisclosureMode);
    return () => {
      window.removeEventListener("hashchange", revealFragment);
      mobile.removeEventListener("change", syncDisclosureMode);
    };
  }, []);

  return null;
}
