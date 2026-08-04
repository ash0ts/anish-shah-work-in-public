export const ROOM_MINIMUM_VIEWPORT_WIDTH = 1100;
export const POCKET_ROOM_MINIMUM_VIEWPORT_WIDTH = 320;
export const POCKET_ROOM_MINIMUM_VIEWPORT_HEIGHT = 560;

export type RoomPresentationTier =
  | "static"
  | "pocket"
  | "desktop-perspective"
  | "desktop-fisheye";

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
  viewportHeight: number;
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
  tier: RoomPresentationTier;
  reasons: readonly RoomCapabilityReason[];
}>;

export function evaluateRoomCapability(
  input: RoomCapabilityInput,
): RoomCapabilityResult {
  const reasons: RoomCapabilityReason[] = [];
  const desktop =
    input.viewportWidth >= ROOM_MINIMUM_VIEWPORT_WIDTH && input.finePointer;

  if (
    input.viewportWidth < POCKET_ROOM_MINIMUM_VIEWPORT_WIDTH ||
    (!desktop && input.viewportHeight < POCKET_ROOM_MINIMUM_VIEWPORT_HEIGHT)
  ) {
    reasons.push("narrow-viewport");
  }
  if (input.reducedMotion) reasons.push("reduced-motion");
  if (input.forcedColors) reasons.push("forced-colors");
  if (input.zoomScale >= 2) reasons.push("zoomed");
  if (input.saveData) reasons.push("save-data");
  if (!input.documentVisible) reasons.push("document-hidden");
  if (!input.webgl2Available) reasons.push("webgl2-unavailable");

  if (reasons.length > 0) return { eligible: false, tier: "static", reasons };

  return {
    eligible: true,
    tier: desktop ? "desktop-fisheye" : "pocket",
    reasons: [],
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
    return { eligible: false, tier: "static", reasons: ["checking"] };
  }

  const connection = (navigator as NavigatorWithConnection).connection;

  return evaluateRoomCapability({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    finePointer: window.matchMedia("(pointer: fine)").matches,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    zoomScale: window.visualViewport?.scale ?? 1,
    saveData: connection?.saveData === true,
    documentVisible: document.visibilityState === "visible",
    webgl2Available: detectWebGL2Support(),
  });
}
