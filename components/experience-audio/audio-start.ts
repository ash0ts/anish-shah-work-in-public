export const EXPERIENCE_AUDIO_START_TIMEOUT_MS = 2_500;

type TimeoutHandle = ReturnType<typeof setTimeout>;

type AudioStartDeadlineOptions = {
  cancel?: (handle: TimeoutHandle) => void;
  schedule?: (callback: () => void, timeoutMs: number) => TimeoutHandle;
  timeoutMs?: number;
};

export class ExperienceAudioStartTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Experience audio did not start within ${timeoutMs}ms.`);
    this.name = "ExperienceAudioStartTimeoutError";
  }
}

/**
 * Bound browser audio startup so a stalled AudioContext can never leave the
 * shared control in a permanent loading state. The timer functions are
 * injectable to keep the policy deterministic in unit tests.
 */
export async function startAudioWithinDeadline<T>(
  start: () => Promise<T>,
  options: AudioStartDeadlineOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? EXPERIENCE_AUDIO_START_TIMEOUT_MS;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timeoutHandle: TimeoutHandle | null = null;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = schedule(() => {
      reject(new ExperienceAudioStartTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([start(), timeout]);
  } finally {
    if (timeoutHandle !== null) cancel(timeoutHandle);
  }
}
