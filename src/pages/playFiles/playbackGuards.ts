export type BooleanRef = { current: boolean };

export const resolvePlayTargetIndex = (playlistLength: number, currentIndex: number): number | null => {
  if (playlistLength <= 0) return null;
  if (currentIndex < 0) return 0;
  return currentIndex < playlistLength ? currentIndex : 0;
};

export const tryAcquireSingleFlight = (ref: BooleanRef): boolean => {
  if (ref.current) return false;
  ref.current = true;
  return true;
};

export const releaseSingleFlight = (ref: BooleanRef): void => {
  ref.current = false;
};

export type VolumeUiTarget = {
  index: number;
  setAtMs: number;
};

export type VolumeSyncDecision = 'apply' | 'clear' | 'defer';

export const resolveVolumeSyncDecision = (
  pendingTarget: VolumeUiTarget | null,
  nextIndex: number,
  nowMs: number,
  holdMs = 2500,
): VolumeSyncDecision => {
  if (!pendingTarget) return 'apply';
  if (pendingTarget.index === nextIndex) return 'clear';
  if (nowMs - pendingTarget.setAtMs < holdMs) return 'defer';
  return 'clear';
};
