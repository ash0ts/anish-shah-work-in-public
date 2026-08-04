import type { ReactNode } from "react";
import { RoomExperienceProvider } from "@/components/play/room-platform/RoomExperienceProvider";
import { travelAtlasEnabled } from "@/lib/server/travel";
import { simulationExperienceEnabled } from "@/lib/server/simulation/policy";

export default function PlayLayout({ children }: { children: ReactNode }) {
  return (
    <RoomExperienceProvider
      simulationEnabled={simulationExperienceEnabled()}
      travelEnabled={travelAtlasEnabled()}
    >
      {children}
    </RoomExperienceProvider>
  );
}
