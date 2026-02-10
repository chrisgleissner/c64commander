/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type BooleanRef = { current: boolean };

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
