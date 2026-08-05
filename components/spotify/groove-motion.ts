export type GrooveNavigationIntent = "forward" | "backward";

const FULL_TURN = 360;
const HALF_TURN = FULL_TURN / 2;
const ANGLE_EPSILON = 1e-7;

export function normalizeGrooveAngle(angle: number) {
  const normalized = ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Math.abs(normalized - FULL_TURN) < ANGLE_EPSILON ? 0 : normalized;
}

export function grooveAngleForIndex(index: number, total: number) {
  return total > 0 ? (index / total) * FULL_TURN : 0;
}

export function grooveNavigationIntent(
  fromIndex: number,
  toIndex: number,
): GrooveNavigationIntent {
  return toIndex < fromIndex ? "backward" : "forward";
}

export function resolveGrooveTargetAngle(
  currentAngle: number,
  selectedAngle: number,
  intent: GrooveNavigationIntent,
) {
  const currentNormalized = normalizeGrooveAngle(currentAngle);
  const selectedNormalized = normalizeGrooveAngle(selectedAngle);
  const clockwiseDelta = normalizeGrooveAngle(
    selectedNormalized - currentNormalized,
  );

  let delta: number;
  if (Math.abs(clockwiseDelta - HALF_TURN) < ANGLE_EPSILON) {
    delta = intent === "backward" ? -HALF_TURN : HALF_TURN;
  } else {
    delta =
      clockwiseDelta < HALF_TURN
        ? clockwiseDelta
        : clockwiseDelta - FULL_TURN;
  }

  return currentAngle + delta;
}
