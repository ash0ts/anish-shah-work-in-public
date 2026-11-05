"use client";

import { useCallback, useEffect, useRef } from "react";

/** Focus after route paint, but never override subsequent visitor input. */
export function useRoomFocus() {
  const focusRequestEpoch = useRef(0);
  const focusRequestCleanup = useRef<() => void>(() => undefined);
  const focusAfterPaint = useCallback((selectors: string | string[]) => {
    focusRequestCleanup.current();
    const requestEpoch = ++focusRequestEpoch.current;
    const candidates = Array.isArray(selectors) ? selectors : [selectors];
    let attempts = 0;
    let stableFrames = 0;
    let frame: number | null = null;
    let cancelled = false;

    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("focusin", cancelForFocusChange, true);
      window.removeEventListener("keydown", cancelForUserInput, true);
      window.removeEventListener("pointerdown", cancelForUserInput, true);
      if (focusRequestCleanup.current === cleanup) {
        focusRequestCleanup.current = () => undefined;
      }
    };

    const cancelForUserInput = () => cleanup();
    const cancelForFocusChange = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        candidates.some((selector) => target.matches(selector))
      ) {
        return;
      }
      cleanup();
    };
    focusRequestCleanup.current = cleanup;
    window.addEventListener("focusin", cancelForFocusChange, true);
    window.addEventListener("keydown", cancelForUserInput, true);
    window.addEventListener("pointerdown", cancelForUserInput, true);

    const focusAvailableTarget = () => {
      frame = null;
      if (cancelled || requestEpoch !== focusRequestEpoch.current) {
        cleanup();
        return;
      }
      for (const selector of candidates) {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || element.closest("[inert]")) continue;
        if (document.activeElement !== element) {
          element.focus({ preventScroll: true });
        }
        stableFrames = document.activeElement === element ? stableFrames + 1 : 0;
        attempts += 1;
        if (stableFrames < 12 && attempts < 180) {
          frame = requestAnimationFrame(focusAvailableTarget);
        } else {
          cleanup();
        }
        return;
      }
      stableFrames = 0;
      attempts += 1;
      if (attempts < 180) frame = requestAnimationFrame(focusAvailableTarget);
      else cleanup();
    };

    frame = requestAnimationFrame(focusAvailableTarget);
  }, []);

  useEffect(
    () => () => {
      focusRequestCleanup.current();
    },
    [],
  );

  return focusAfterPaint;
}
