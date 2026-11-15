"use client";

import { useLayoutEffect } from "react";

export function SupportingDisclosureBehavior() {
  useLayoutEffect(() => {
    const reveal = () => {
      let id;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const target = document.getElementById(id);
      let disclosure = target?.closest<HTMLDetailsElement>("details[data-supporting-disclosure]");
      if (!target || !disclosure) return;
      while (disclosure) {
        disclosure.open = true;
        disclosure = disclosure.parentElement?.closest<HTMLDetailsElement>("details[data-supporting-disclosure]") ?? null;
      }
      window.requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return null;
}
