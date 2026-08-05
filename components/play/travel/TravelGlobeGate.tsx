"use client";

import { type ReactNode, useEffect, useState } from "react";

import { detectWebGL2Support } from "../room-3d/room-capability";
import {
  conservativeTravelZoomScale,
  evaluateTravelGlobeCapability,
  type TravelGlobeCapability,
} from "./travel-globe-capability";

type NavigatorWithConnection = Navigator & {
  connection?: { saveData?: boolean };
};

const checking: TravelGlobeCapability = {
  eligible: false,
  reasons: ["checking"],
};

function detectCapability(): TravelGlobeCapability {
  const connection = (navigator as NavigatorWithConnection).connection;
  const coarsePrimaryPointer = window.matchMedia("(pointer: coarse)").matches;
  return evaluateTravelGlobeCapability({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    saveData: connection?.saveData === true,
    zoomScale: conservativeTravelZoomScale({
      visualScale: window.visualViewport?.scale,
      outerWidth: window.outerWidth,
      innerWidth: window.innerWidth,
      coarsePrimaryPointer,
    }),
    webgl2Available: detectWebGL2Support(),
  });
}

export function TravelGlobeGate({
  children,
  fallback,
  onCapabilityChange,
}: {
  children: ReactNode;
  fallback: ReactNode;
  onCapabilityChange?: (capability: TravelGlobeCapability) => void;
}) {
  const [capability, setCapability] = useState(checking);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    const media = [
      window.matchMedia("(prefers-reduced-motion: reduce)"),
      window.matchMedia("(forced-colors: active)"),
    ];
    const update = () => {
      const next = detectCapability();
      setCapability(next);
      onCapabilityChange?.(next);
    };
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(update);
    });
    window.visualViewport?.addEventListener("resize", update, { passive: true });
    for (const query of media) query.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.visualViewport?.removeEventListener("resize", update);
      for (const query of media) query.removeEventListener("change", update);
    };
  }, [onCapabilityChange]);

  return capability.eligible ? children : fallback;
}
