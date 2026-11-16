export type GearStatus = "owned" | "incoming" | "planned" | "optional";
export type GearKind =
  | "amp" | "board" | "controller" | "instrument" | "midi" | "pedal"
  | "pickup" | "power" | "recording" | "switcher" | "utility";

export type GearItem = {
  id: string;
  brand: string;
  model: string;
  kind: GearKind;
  status: GearStatus;
  chainGroup: string;
  signalOrder: number | null;
  equipboardQuery: string;
  note: string;
};

export type GearManifest = {
  version: 1;
  updatedAt: string;
  profile: {
    displayName: string;
    equipboardProfileUrl: string | null;
    publicNote: string;
  };
  statusLabels: Record<GearStatus, string>;
  items: GearItem[];
};
