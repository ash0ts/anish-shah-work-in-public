"use client";

import { animate } from "animejs";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import { useExperienceAudio } from "@/components/experience-audio/ExperienceAudioProvider";
import type { RoomObjectId } from "../room-platform/room-types";

const ENTRY_CUE_BY_OBJECT = {
  watch: "watch-power",
  read: "read-page",
  collect: "collect-crate",
  play: "play-computer-boot",
  move: "move-tv",
} as const satisfies Partial<Record<RoomObjectId, string>>;

type EntrancePreset = {
  initial: CSSProperties;
  animation: Record<string, unknown>;
};

const ENTRANCE_PRESETS: Record<RoomObjectId, EntrancePreset> = {
  watch: {
    initial: { opacity: 0, transform: "scaleY(0.035)" },
    animation: {
      opacity: [0, 1],
      scaleY: [0.035, 1],
      duration: 360,
      ease: "out(4)",
    },
  },
  read: {
    initial: { opacity: 0, transform: "translateX(-20px) scaleX(0.06)" },
    animation: {
      opacity: [0, 1],
      translateX: [-20, 0],
      scaleX: [0.06, 1],
      duration: 430,
      ease: "out(4)",
    },
  },
  listen: {
    initial: { opacity: 0, transform: "translateY(18px) scale(0.86)" },
    animation: {
      opacity: [0, 1],
      translateY: [18, 0],
      scale: [0.86, 1],
      duration: 380,
      ease: "out(3)",
    },
  },
  collect: {
    initial: { opacity: 0, transform: "translateY(58px)" },
    animation: {
      opacity: [0, 1],
      translateY: [58, 0],
      duration: 440,
      ease: "out(4)",
    },
  },
  play: {
    initial: { opacity: 0, transform: "scale(0.9, 0.16)" },
    animation: {
      opacity: [0, 1],
      scaleX: [0.9, 1],
      scaleY: [0.16, 1],
      duration: 390,
      ease: "out(4)",
    },
  },
  move: {
    initial: { opacity: 0, transform: "scaleY(0.06)" },
    animation: {
      opacity: [0, 1, 0.42, 1],
      scaleY: [0.06, 1],
      duration: 420,
      ease: "out(3)",
    },
  },
  travel: {
    initial: { opacity: 0, transform: "scale(0.12)" },
    animation: {
      opacity: [0, 1],
      scale: [0.12, 1],
      duration: 520,
      ease: "out(4)",
    },
  },
};

export function MatchCutSurface({
  children,
  className,
  objectId,
  surface,
}: {
  children: ReactNode;
  className: string;
  objectId: RoomObjectId;
  surface: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const preset = ENTRANCE_PRESETS[objectId];
  const { enabled: audioEnabled, playCue } = useExperienceAudio();

  useEffect(() => {
    if (!audioEnabled || objectId === "listen") return;
    playCue(ENTRY_CUE_BY_OBJECT[objectId]);
  }, [audioEnabled, objectId, playCue]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      element.removeAttribute("style");
      element.dataset.matchCutState = "settled";
      return;
    }

    element.dataset.matchCutState = "animating";
    Object.assign(element.style, preset.initial);
    element.style.transformOrigin =
      objectId === "collect" ? "center bottom" : "center center";

    const animation = animate(element, {
      ...preset.animation,
      onComplete: () => {
        element.removeAttribute("style");
        element.dataset.matchCutState = "settled";
      },
    });

    return () => {
      animation.cancel();
    };
  }, [objectId, preset]);

  return (
    <div
      className={className}
      data-match-cut-object={objectId}
      data-match-cut-state="pending"
      data-match-cut-surface={surface}
      ref={ref}
    >
      {children}
    </div>
  );
}
