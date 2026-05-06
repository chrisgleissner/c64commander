/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const HOME_CPU_SPEED_SLIDER_PROBE_PREFIX = "CPU slider probe ";

export type HomeCpuSpeedSliderProbePhase = "idle" | "pending" | "success" | "error";

export type HomeCpuSpeedSliderProbeSnapshot = {
  authoritativeValue: string;
  completedAtIso: string | null;
  displayValue: string;
  durationMs: number | null;
  errorMessage: string | null;
  phase: HomeCpuSpeedSliderProbePhase;
  releasedAtIso: string | null;
  targetValue: string;
};

export const createHomeCpuSpeedSliderProbeSnapshot = (
  value: string,
  overrides: Partial<HomeCpuSpeedSliderProbeSnapshot> = {},
): HomeCpuSpeedSliderProbeSnapshot => ({
  authoritativeValue: value,
  completedAtIso: null,
  displayValue: value,
  durationMs: null,
  errorMessage: null,
  phase: "idle",
  releasedAtIso: null,
  targetValue: value,
  ...overrides,
});

export const formatHomeCpuSpeedSliderProbe = (snapshot: HomeCpuSpeedSliderProbeSnapshot) =>
  `${HOME_CPU_SPEED_SLIDER_PROBE_PREFIX}${JSON.stringify(snapshot)}`;
