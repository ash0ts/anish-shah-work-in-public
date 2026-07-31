"use client";

import { useEffect } from "react";

export function FilteredResultFocus({
  active,
  targetId,
}: {
  active: boolean;
  targetId: string;
}) {
  useEffect(() => {
    if (!active) return;
    const hash = window.location.hash.slice(1);
    if (
      hash &&
      hash !== targetId &&
      hash !== "bibliography" &&
      hash !== "work-index"
    ) {
      return;
    }
    const target = document.getElementById(targetId);
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      target.focus({ preventScroll: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, targetId]);

  return null;
}
