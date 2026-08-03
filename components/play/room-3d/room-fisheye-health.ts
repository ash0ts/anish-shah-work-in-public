export const FISHEYE_WARMUP_FRAME_COUNT = 4;
export const FISHEYE_SAMPLE_WINDOW_SIZE = 5;
export const FISHEYE_DEGRADED_FRAME_THRESHOLD_MS = 33;
export const FISHEYE_SEVERE_FRAME_THRESHOLD_MS = 50;

export type FisheyeHealthState = Readonly<{
  completedFrameCount: number;
  downgraded: boolean;
  samples: readonly number[];
}>;

export function createFisheyeHealthState(): FisheyeHealthState {
  return {
    completedFrameCount: 0,
    downgraded: false,
    samples: [],
  };
}

export function recordCompletedFisheyeFrame(
  state: FisheyeHealthState,
  durationMs: number,
): { state: FisheyeHealthState; downgrade: boolean } {
  if (state.downgraded || !Number.isFinite(durationMs) || durationMs < 0) {
    return { state, downgrade: false };
  }

  const completedFrameCount = state.completedFrameCount + 1;
  if (completedFrameCount <= FISHEYE_WARMUP_FRAME_COUNT) {
    return {
      state: { ...state, completedFrameCount },
      downgrade: false,
    };
  }

  const samples = [...state.samples, durationMs].slice(
    -FISHEYE_SAMPLE_WINDOW_SIZE,
  );
  const degradedCount = samples.filter(
    (sample) => sample > FISHEYE_DEGRADED_FRAME_THRESHOLD_MS,
  ).length;
  const severeCount = samples.filter(
    (sample) => sample > FISHEYE_SEVERE_FRAME_THRESHOLD_MS,
  ).length;
  const downgrade = degradedCount >= 3 || severeCount >= 2;

  return {
    state: {
      completedFrameCount,
      downgraded: downgrade,
      samples,
    },
    downgrade,
  };
}
