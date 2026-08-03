export const ROOM_MINIMUM_VIEWPORT_WIDTH = 1100;

export type RoomCapabilityReason =
  | "checking"
  | "narrow-viewport"
  | "coarse-pointer"
  | "reduced-motion"
  | "forced-colors"
  | "zoomed"
  | "save-data"
  | "document-hidden"
  | "webgl2-unavailable";

export type RoomCapabilityInput = Readonly<{
  viewportWidth: number;
  finePointer: boolean;
  reducedMotion: boolean;
  forcedColors: boolean;
  zoomScale: number;
  saveData: boolean;
  documentVisible: boolean;
  webgl2Available: boolean;
}>;

export type RoomCapabilityResult = Readonly<{
  eligible: boolean;
  reasons: readonly RoomCapabilityReason[];
}>;

export function evaluateRoomCapability(
  input: RoomCapabilityInput,
): RoomCapabilityResult {
  const reasons: RoomCapabilityReason[] = [];

  if (input.viewportWidth < ROOM_MINIMUM_VIEWPORT_WIDTH) {
    reasons.push("narrow-viewport");
  }
  if (!input.finePointer) reasons.push("coarse-pointer");
  if (input.reducedMotion) reasons.push("reduced-motion");
  if (input.forcedColors) reasons.push("forced-colors");
  if (input.zoomScale >= 2) reasons.push("zoomed");
  if (input.saveData) reasons.push("save-data");
  if (!input.documentVisible) reasons.push("document-hidden");
  if (!input.webgl2Available) reasons.push("webgl2-unavailable");

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

type NavigatorWithConnection = Navigator & {
  connection?: {
    saveData?: boolean;
  };
};

let cachedWebGL2Support: boolean | null = null;

export function detectWebGL2Support() {
  if (cachedWebGL2Support !== null) return cachedWebGL2Support;
  if (typeof document === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: true,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "low-power",
      stencil: false,
    });

    if (!context) {
      cachedWebGL2Support = false;
      return false;
    }
    context.getExtension("WEBGL_lose_context")?.loseContext();
    cachedWebGL2Support = true;
    return true;
  } catch {
    cachedWebGL2Support = false;
    return false;
  }
}

export function detectRoomCapability(): RoomCapabilityResult {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof navigator === "undefined"
  ) {
    return { eligible: false, reasons: ["checking"] };
  }

  const connection = (navigator as NavigatorWithConnection).connection;

  return evaluateRoomCapability({
    viewportWidth: window.innerWidth,
    finePointer: window.matchMedia("(pointer: fine)").matches,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    zoomScale: window.visualViewport?.scale ?? 1,
    saveData: connection?.saveData === true,
    documentVisible: document.visibilityState === "visible",
    webgl2Available: detectWebGL2Support(),
  });
}
