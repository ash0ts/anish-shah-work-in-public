"use client";
import { useEffect, useRef } from "react";
import { createDraggable } from "animejs";
import type { InternetObject } from "@/lib/simulation/personal-internet";
import { SITE_COPY } from "@/lib/copy";
import styles from "./Conversation.module.css";

export function ArtifactWindow({
  object,
  index,
  still,
  close,
  ask,
  select,
  selected,
}: {
  object: InternetObject;
  index: number;
  still: boolean;
  close: () => void;
  ask: (origin: HTMLElement) => void;
  select: () => void;
  selected: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const handle = useRef<HTMLSpanElement>(null);
  const drag = useRef<ReturnType<typeof createDraggable> | null>(null);
  useEffect(() => {
    const media = matchMedia(
      "(min-width: 900px) and (prefers-reduced-motion: no-preference) and (forced-colors: none)",
    );
    const sync = () => {
      drag.current?.revert();
      drag.current = null;
      if (
        media.matches &&
        !still &&
        !document.hidden &&
        ref.current &&
        handle.current &&
        ref.current.parentElement
      ) {
        drag.current = createDraggable(ref.current, {
          trigger: handle.current,
          container: ref.current.parentElement,
          containerPadding: 12,
          containerFriction: 1,
          velocityMultiplier: 0,
          releaseEase: "outQuad",
        });
      }
    };
    sync();
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", sync);
    return () => {
      drag.current?.revert();
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", sync);
    };
  }, [still]);
  const copy = SITE_COPY.simulation;
  return (
    <section
      ref={ref}
      className={styles.artifact}
      data-window={index}
      aria-label={object.label}
    >
      <header className={styles.windowBar}>
        <span ref={handle} className={styles.dragHandle}>
          {object.kind}.open
        </span>
        <button onClick={close} aria-label={`Close ${object.label}`}>
          ×
        </button>
      </header>
      <div className={styles.artifactBody}>
        <small>{object.period}</small>
        <h2 tabIndex={-1}>{object.title}</h2>
        <p>{object.text}</p>
        {object.limit && <p>{object.limit}</p>}
        <a href={object.href}>{copy["project-link"]} ↗</a>
        <div className={styles.windowActions}>
          <button onClick={select} aria-pressed={selected}>
            {selected ? copy["selected-label"] : copy["select-label"]}
          </button>
          <button onClick={(event) => ask(event.currentTarget)}>
            {copy["ask-label"]}
          </button>
          <button
            className={styles.resetPosition}
            onClick={() => drag.current?.reset()}
          >
            {copy["reset-window"]}
          </button>
        </div>
      </div>
    </section>
  );
}
