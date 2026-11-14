"use client";

import { animate } from "animejs";
import { useCallback, useRef } from "react";

/** Own every animation and completion frame; route changes cancel the epoch. */
export function useRoomTransitions() {
  const transitionEpoch = useRef(0);
  const transitionAnimations = useRef<Array<ReturnType<typeof animate>>>([]);
  const transitionFrame = useRef<number | null>(null);
  const resetTransitionVisuals = useCallback(() => {
    for (const selector of [
      "[data-room-runtime]",
      "[data-room-stage-shell]",
      "[data-room-screen]",
      "[data-room-object-control]",
      "[data-room-static-stage]",
    ]) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        element.style.removeProperty("opacity");
        element.style.removeProperty("transform");
      }
    }
  }, []);

  const finishTransitionVisuals = useCallback(() => {
    if (transitionFrame.current !== null) {
      cancelAnimationFrame(transitionFrame.current);
      transitionFrame.current = null;
    }
    for (const animation of transitionAnimations.current) animation.cancel();
    transitionAnimations.current = [];
    resetTransitionVisuals();
  }, [resetTransitionVisuals]);

  const cancelTransition = useCallback(() => {
    transitionEpoch.current += 1;
    finishTransitionVisuals();
  }, [finishTransitionVisuals]);

  const trackAnimation = useCallback(
    (animation: ReturnType<typeof animate>) => {
      transitionAnimations.current.push(animation);
      return animation;
    },
    [],
  );

  const guaranteeTransitionCompletion = useCallback(
    (duration: number, epoch: number, complete: () => void) => {
      const startedAt = performance.now();
      const check = (now: number) => {
        if (epoch !== transitionEpoch.current) return;
        if (now - startedAt >= duration) {
          transitionFrame.current = null;
          complete();
          return;
        }
        transitionFrame.current = requestAnimationFrame(check);
      };
      transitionFrame.current = requestAnimationFrame(check);
    },
    [],
  );

  return { transitionEpoch, finishTransitionVisuals, cancelTransition, trackAnimation, guaranteeTransitionCompletion };
}
