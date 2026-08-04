import type { ReactNode } from "react";
import { RoomExperienceProvider } from "@/components/play/room-platform/RoomExperienceProvider";
import {
  roomExperienceEnabled,
  travelAtlasEnabled,
} from "@/lib/server/play-experience";
import { simulationExperienceEnabled } from "@/lib/server/simulation/policy";

export default function PlayLayout({ children }: { children: ReactNode }) {
  if (!roomExperienceEnabled()) return children;
  return (
    <RoomExperienceProvider
      simulationEnabled={simulationExperienceEnabled()}
      travelEnabled={travelAtlasEnabled()}
    >
      {children}
    </RoomExperienceProvider>
  );
}
