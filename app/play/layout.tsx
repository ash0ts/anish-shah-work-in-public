import type { ReactNode } from "react";
import { RoomExperienceProvider } from "@/components/play/room-platform/RoomExperienceProvider";
import { travelAtlasEnabled } from "@/lib/server/travel";
import { simulationExperienceVisible } from "@/lib/server/simulation/mode";

export default function PlayLayout({ children }: { children: ReactNode }) {
  return (
    <RoomExperienceProvider
      simulationEnabled={simulationExperienceVisible()}
      travelEnabled={travelAtlasEnabled()}
    >
      {children}
    </RoomExperienceProvider>
  );
}
