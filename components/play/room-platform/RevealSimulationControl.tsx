"use client";

import { animate, type JSAnimation } from "animejs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
import { SITE_COPY } from "@/lib/copy";
import styles from "./RevealSimulationControl.module.css";

export function RevealSimulationControl({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const { playCue } = useExperienceAudio();
  const [transitioning, setTransitioning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const animations = useRef<JSAnimation[]>([]);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invokingControl = useRef<HTMLAnchorElement>(null);
  const cancelControl = useRef<HTMLButtonElement>(null);
  const navigationStarted = useRef(false);

  const stopTransition = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
    if (completionTimer.current) clearTimeout(completionTimer.current);
    completionTimer.current = null;
  }, []);

  useEffect(() => stopTransition, [stopTransition]);

  useEffect(() => {
    if (!transitioning) return;
    const obscured = document.querySelectorAll<HTMLElement>(
      "[data-room-overview], [data-room-runtime], body > .skip-link, body > header, body > .site-frame > footer",
    );
    const previousAttributes = [...obscured].map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    const previousOverflow = document.documentElement.style.overflow;
    for (const element of obscured) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    document.documentElement.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      cancelControl.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.style.overflow = previousOverflow;
      for (const { element, inert, ariaHidden } of previousAttributes) {
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [transitioning]);

  const cancel = useCallback(() => {
    if (!transitioning || navigationStarted.current) return;
    stopTransition();
    setTransitioning(false);
    requestAnimationFrame(() => {
      invokingControl.current?.focus({ preventScroll: true });
    });
  }, [stopTransition, transitioning]);

  const navigate = useCallback(() => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    router.push("/simulation", { scroll: false });
  }, [router]);

  const reveal = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      transitioning
    ) {
      return;
    }
    event.preventDefault();
    navigationStarted.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reduced);
    setTransitioning(true);
    playCue("simulation-reveal");
    router.prefetch("/simulation");

    requestAnimationFrame(() => {
      if (reduced) {
        completionTimer.current = setTimeout(navigate, 180);
        return;
      }
      const surface = document.querySelector<HTMLElement>(
        "[data-room-runtime] [data-room-stage-shell], [data-room-static-stage]",
      );
      const overlay = document.querySelector<HTMLElement>(
        "[data-simulation-reveal-overlay]",
      );
      const robot = document.querySelector<HTMLElement>(
        "[data-simulation-robot]",
      );
      const wafer = document.querySelector<HTMLElement>(
        "[data-simulation-memory-wafer]",
      );
      if (!surface || !overlay || !robot || !wafer) {
        navigate();
        return;
      }
      animations.current = [
        animate(overlay, {
          opacity: [0, 1],
          duration: 180,
          ease: "out(3)",
        }),
        animate(robot, {
          scale: [0.72, 1],
          translateY: [36, 0],
          duration: 440,
          ease: "out(4)",
        }),
        animate(surface, {
          scaleX: [1, 0.76, 0.18],
          scaleY: [1, 1.08, 0.045],
          rotate: [0, -2, 7],
          translateY: [0, -12, 42],
          opacity: [1, 0.96, 0],
          duration: 760,
          ease: "inOut(4)",
        }),
        animate(wafer, {
          opacity: [0, 1, 1, 0],
          scale: [0.2, 1.08, 0.72, 0.12],
          translateX: [-90, -22, 48, 112],
          duration: 880,
          ease: "inOut(3)",
        }),
      ];
      completionTimer.current = setTimeout(navigate, 940);
    });
  };

  const containFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    cancelControl.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <Link
        aria-disabled={transitioning || undefined}
        className={className}
        data-reveal-simulation
        href="/simulation"
        onClick={reveal}
        prefetch={false}
        ref={invokingControl}
      >
        {SITE_COPY.simulation["ingress-cta"]}
      </Link>
      {transitioning && typeof document !== "undefined"
        ? createPortal(
            <section
              aria-label="Revealing the Anish simulation"
              aria-modal="true"
              className={styles.simulationReveal}
              data-reduced-motion={reducedMotion || undefined}
              data-simulation-reveal-overlay
              onKeyDown={containFocus}
              role="dialog"
            >
              <div aria-hidden="true" className={styles.simulationField}>
                <div className={styles.memoryWafer} data-simulation-memory-wafer>
                  <i />
                  <i />
                  <i />
                  <i />
                  <span>ROOM / MEMORY</span>
                </div>
                <div className={styles.simulationRobot} data-simulation-robot>
                  <i className={styles.robotAntenna} />
                  <div className={styles.robotHead}>
                    <i />
                    <i />
                    <span />
                  </div>
                  <div className={styles.robotBody}>
                    <b>ME</b>
                    <span>SIM</span>
                  </div>
                </div>
              </div>
              <div className={styles.simulationCopy}>
                <p>{SITE_COPY.simulation["transition-eyebrow"]}</p>
                <h2>{SITE_COPY.simulation["transition-title"]}</h2>
                <span role="status">
                  {SITE_COPY.simulation["transition-summary"]}
                </span>
                <button onClick={cancel} ref={cancelControl} type="button">
                  {SITE_COPY.simulation["transition-cancel-cta"]}
                </button>
              </div>
            </section>,
            document.body,
          )
        : null}
    </>
  );
}
