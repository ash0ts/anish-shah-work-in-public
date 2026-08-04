"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { SITE_COPY } from "@/lib/copy";
import { useRoomExperience } from "./RoomExperienceProvider";

export function RevealSimulationControl({
  className,
}: {
  className?: string;
}) {
  const room = useRoomExperience();

  if (!room.simulationEnabled) return null;

  const reveal = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    room.revealSimulation();
  };

  return (
    <Link
      aria-disabled={room.simulationTransitioning || undefined}
      className={className}
      data-reveal-simulation
      href="/simulation"
      onClick={reveal}
      prefetch={false}
    >
      {SITE_COPY.simulation["ingress-cta"]}
    </Link>
  );
}
