export type RetryDeadlineState = {
  retryNotBefore: string | null;
  retryTimestamp: number;
  blocked: boolean;
};

export function retryDeadlineState(
  serverValue: string | null,
  localValue: string | null,
  now: number,
): RetryDeadlineState {
  const candidates = [serverValue, localValue]
    .map((value) => ({ value, timestamp: value ? Date.parse(value) : Number.NaN }))
    .filter(
      (candidate): candidate is { value: string; timestamp: number } =>
        candidate.value !== null && Number.isFinite(candidate.timestamp),
    )
    .sort((left, right) => right.timestamp - left.timestamp);
  const selected = candidates[0];
  const retryTimestamp = selected?.timestamp ?? Number.NaN;

  return {
    retryNotBefore: selected?.value ?? null,
    retryTimestamp,
    blocked: Number.isFinite(retryTimestamp) && retryTimestamp > now,
  };
}
