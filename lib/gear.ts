import manifestJson from "@/content/play/gear.v1.json";
import type { GearItem, GearManifest, GearStatus } from "@/types/gear";

const manifest = manifestJson as GearManifest;

export function publicGearManifest(): GearManifest {
  return manifest;
}

export function orderedSignalChain(items: readonly GearItem[]): GearItem[] {
  return items
    .filter((item) => item.signalOrder !== null && item.status !== "optional")
    .toSorted((left, right) => (left.signalOrder ?? 0) - (right.signalOrder ?? 0));
}

export function gearByStatus(
  items: readonly GearItem[],
  status: GearStatus,
): GearItem[] {
  return items.filter((item) => item.status === status);
}
