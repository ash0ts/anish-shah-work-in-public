import type { SimulationMode } from "../types";

export type SimulationCapabilities = {
  reducedMotion: boolean;
  forcedColors: boolean;
  zoomScale: number;
  saveData: boolean;
  canvasAvailable: boolean;
  viewportWidth: number;
};

export function recommendedSimulationMode(
  capabilities: SimulationCapabilities,
): SimulationMode {
  return capabilities.reducedMotion ||
    capabilities.forcedColors ||
    capabilities.zoomScale > 1.25 ||
    capabilities.saveData ||
    !capabilities.canvasAvailable ||
    capabilities.viewportWidth < 760
    ? "tactical"
    : "action";
}

export function browserSimulationCapabilities(): SimulationCapabilities {
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    zoomScale: window.visualViewport?.scale ?? 1,
    saveData: Boolean(
      (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData,
    ),
    canvasAvailable: Boolean(document.createElement("canvas").getContext("2d")),
    viewportWidth: window.innerWidth,
  };
}
