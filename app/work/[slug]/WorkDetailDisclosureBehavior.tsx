"use client";

import { useLayoutEffect } from "react";

export function WorkDetailDisclosureBehavior() {
  useLayoutEffect(() => {
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

    revealFragment();
    window.addEventListener("hashchange", revealFragment);
    return () => {
      window.removeEventListener("hashchange", revealFragment);
    };
  }, []);

  return null;
}
