export type TravelGlobeCapabilityReason =
  | "checking"
  | "reduced-motion"
  | "forced-colors"
  | "save-data"
  | "high-zoom"
  | "webgl2-unavailable";

export type TravelGlobeCapability = {
  eligible: boolean;
  reasons: TravelGlobeCapabilityReason[];
};

/**
 * visualViewport.scale covers pinch zoom. Desktop browsers frequently leave it
 * at 1 during page zoom, so the outer/inner viewport ratio is a conservative
 * second signal. The ratio is ignored for coarse primary pointers because
 * mobile browser chrome can otherwise resemble desktop zoom.
 */
export function conservativeTravelZoomScale(input: {
  visualScale: number | null | undefined;
  outerWidth: number;
  innerWidth: number;
  coarsePrimaryPointer: boolean;
}): number {
  const visualScale =
    Number.isFinite(input.visualScale) && (input.visualScale ?? 0) > 0
      ? (input.visualScale as number)
      : 1;
  const desktopViewportScale =
    !input.coarsePrimaryPointer &&
    input.outerWidth > 0 &&
    input.innerWidth > 0
      ? input.outerWidth / input.innerWidth
      : 1;
  return Math.max(1, visualScale, desktopViewportScale);
}

export function evaluateTravelGlobeCapability(input: {
  reducedMotion: boolean;
  forcedColors: boolean;
  saveData: boolean;
  zoomScale: number;
  webgl2Available: boolean;
}): TravelGlobeCapability {
  const reasons: TravelGlobeCapabilityReason[] = [];
  if (input.reducedMotion) reasons.push("reduced-motion");
  if (input.forcedColors) reasons.push("forced-colors");
  if (input.saveData) reasons.push("save-data");
  if (input.zoomScale >= 2) reasons.push("high-zoom");
  if (!input.webgl2Available) reasons.push("webgl2-unavailable");
  return { eligible: reasons.length === 0, reasons };
}
