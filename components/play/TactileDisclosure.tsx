"use client";

import { animate, spring } from "animejs";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./TactileCollections.module.css";

/** Native disclosure first; the spring is a disposable enhancement, never state. */
export function TactileDisclosure({ summary, children, kind }: {
  summary: ReactNode;
  children: ReactNode;
  kind: "myanimelist" | "hardcover" | "steam" | "record";
}) {
  const body = useRef<HTMLDivElement>(null);
  const motion = useRef<ReturnType<typeof animate> | null>(null);
  useEffect(() => () => { motion.current?.cancel(); }, []);
  return (
    <details
      className={styles.item}
      data-tactile-item={kind}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
      onToggle={(event) => {
        motion.current?.cancel();
        const element = body.current;
        if (!element) return;
        element.style.removeProperty("transform");
        if (!event.currentTarget.open || window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)").matches) return;
        motion.current = animate(element, {
          translateY: [8, 0],
          ease: spring({ stiffness: 230, damping: 22 }),
          onComplete: () => element.style.removeProperty("transform"),
        });
      }}
    >
      <summary>{summary}<span className={styles.openMark} aria-hidden="true">+</span></summary>
      <div className={styles.itemDetail} ref={body}>{children}</div>
    </details>
  );
}
