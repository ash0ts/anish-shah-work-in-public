"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  detectRoomCapability,
  type RoomCapabilityResult,
} from "./room-capability";

export type Room3DGateProps = {
  children: ReactNode;
  fallback?: ReactNode;
  onCapabilityChange?: (result: RoomCapabilityResult) => void;
};

const checkingResult: RoomCapabilityResult = {
  eligible: false,
  tier: "static",
  reasons: ["checking"],
};

export function useRoomCapability() {
  const [result, setResult] = useState<RoomCapabilityResult>(checkingResult);
  const lastSignature = useRef("");

  useEffect(() => {
    const mediaQueries = [
      window.matchMedia("(pointer: fine)"),
      window.matchMedia("(prefers-reduced-motion: reduce)"),
      window.matchMedia("(forced-colors: active)"),
    ];

    const update = () => {
      const next = detectRoomCapability();
      const signature = `${next.eligible}:${next.tier}:${next.reasons.join(",")}`;
      if (signature === lastSignature.current) return;
      lastSignature.current = signature;
      setResult(next);
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    document.addEventListener("visibilitychange", update);
    window.visualViewport?.addEventListener("resize", update, { passive: true });
    for (const query of mediaQueries) query.addEventListener("change", update);

    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
      window.visualViewport?.removeEventListener("resize", update);
      for (const query of mediaQueries) {
        query.removeEventListener("change", update);
      }
    };
  }, []);

  return result;
}

/**
 * A renderer-free eligibility boundary. Importing this component never imports
 * Three.js; the caller remains responsible for the literal lazy RoomStage
 * import after explicit visitor intent.
 */
export function Room3DGate({
  children,
  fallback = null,
  onCapabilityChange,
}: Room3DGateProps) {
  const result = useRoomCapability();

  useEffect(() => {
    onCapabilityChange?.(result);
  }, [onCapabilityChange, result]);

  return result.eligible ? children : fallback;
}
