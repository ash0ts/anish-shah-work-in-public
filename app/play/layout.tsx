import type { ReactNode } from "react";
import { RoomExperienceProvider } from "@/components/play/room-platform/RoomExperienceProvider";
import { roomExperienceEnabled } from "@/lib/server/play-experience";

export default function PlayLayout({ children }: { children: ReactNode }) {
  if (!roomExperienceEnabled()) return children;
  return <RoomExperienceProvider>{children}</RoomExperienceProvider>;
}
