export type GearStatus = "owned" | "incoming" | "planned" | "optional";
export type GearPlacement = "upper" | "lower" | "both" | "external" | "offboard" | "chassis";
export type GearItem = {
  id: string;
  brand: string;
  model: string;
  kind: string;
  status: GearStatus;
  placement: GearPlacement;
  modelConfirmed: boolean;
  provenance: "owner-confirmed" | "collection-photo" | "build-plan";
  catalogUrl: string | null;
  catalogScope?: "exact" | "family";
  catalogQuery: string;
  noteKey: string;
  legacyIds?: string[];
  instrument?: {
    strings: number;
    manufacturerCode: string | null;
    year: number | null;
    pickups?: { brand: string; model: string };
    finish?: { name: string; confirmed: boolean };
  };
  loop?: number;
  power?: { allocation: string; volts: number };
  footprint?: {
    x: number; y: number; w: number; h: number;
    rotation: number; color: string; knobs: number; switches: number;
    dimensions: "published" | "provisional" | "planning";
  };
};
export type GearManifest = {
  version: 1;
  updatedAt: string;
  profile: { displayName: string; equipboardProfileUrl: string | null };
  build: { id: string; revision: string; state: "planned"; widthMm: number; depthMm: number; spareLoops: number[] };
  items: GearItem[];
};
export type RigPrograms = {
  version: 1;
  presets: { slot: number; labelKey: string; loops: number[] }[];
  op1Commands: { slot: number; labelKey: string; channel: number; cc: number; press: number; release: number }[];
};
